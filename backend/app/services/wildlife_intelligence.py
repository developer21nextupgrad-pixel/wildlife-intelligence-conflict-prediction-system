"""Phase 3 Wildlife Intelligence Integration Service:
- Honest Camera / Village / Coordinate context resolution (zero fake GPS)
- Idempotent Detection -> Sighting linking
- Configurable AlertRule evaluation (species, zone, confidence, repeat-count window)
- Nearest Forest Officer routing + NotificationChannelProvider abstraction (honest stub logging)
- IoT Siren / Boundary Alert Contract dispatch, retry & X-Camera-Key ack verification
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import logging
from typing import Any
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.config import Settings
from app.core.database import is_postgres_backend
from app.models import (
    Alert,
    AlertDeliveryAttempt,
    AlertRule,
    AnimalDetection,
    AnimalIdentity,
    Camera,
    ForestOfficer,
    IotEventRecord,
    Sighting,
    Village,
)
from app.services.camera_security import verify_camera_api_key
from app.services.reid_service import canonical_species_display, normalize_species_family
from app.services.spatial import haversine_km, make_point_geom, resolve_village_id

logger = logging.getLogger("wicps.intelligence")


@dataclass
class ResolvedLocationContext:
    has_real_location: bool
    camera: Camera | None
    village: Village | None
    latitude: float | None
    longitude: float | None
    location_name: str | None
    district: str
    forest_range: str


def _find_nearest_village(db: Session, lat: float, lng: float, max_km: float = 50.0) -> Village | None:
    villages = list(db.execute(select(Village)).scalars().all())
    best_v: Village | None = None
    best_dist = max_km
    for v in villages:
        d = haversine_km(lat, lng, v.latitude, v.longitude)
        if d <= best_dist:
            best_dist = d
            best_v = v
    return best_v


def resolve_detection_context(
    db: Session,
    *,
    camera_id: uuid.UUID | None = None,
    village_id: uuid.UUID | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
    location_name: str | None = None,
) -> ResolvedLocationContext:
    """Resolves real camera/village/GPS context without inventing fallback coordinates."""
    camera: Camera | None = None
    village: Village | None = None

    if camera_id is not None:
        camera = db.get(Camera, camera_id)
        if camera is None:
            raise ValueError("Referenced camera_id does not exist.")

    if village_id is not None:
        village = db.get(Village, village_id)
        if village is None:
            raise ValueError("Referenced village_id does not exist.")
    elif camera is not None and camera.village_id is not None:
        village = db.get(Village, camera.village_id)
    elif camera is not None:
        resolved_vid = resolve_village_id(db, None, camera.zone_name, camera.name)
        if resolved_vid:
            village = db.get(Village, resolved_vid)
    elif location_name and location_name.strip():
        resolved_vid = resolve_village_id(db, None, location_name)
        if resolved_vid:
            village = db.get(Village, resolved_vid)

    # Coordinate precedence: explicit lat/lng > registered camera > selected village > none
    resolved_lat: float | None = None
    resolved_lng: float | None = None
    if latitude is not None and longitude is not None:
        resolved_lat = float(latitude)
        resolved_lng = float(longitude)
        if village is None:
            village = _find_nearest_village(db, resolved_lat, resolved_lng)
    elif camera is not None:
        resolved_lat = float(camera.latitude)
        resolved_lng = float(camera.longitude)
    elif village is not None:
        resolved_lat = float(village.latitude)
        resolved_lng = float(village.longitude)

    has_real = resolved_lat is not None and resolved_lng is not None
    clean_location = (
        location_name.strip()
        if location_name and location_name.strip()
        else (camera.zone_name if camera else (village.name if village else None))
    )
    district = village.district if village else "Bandipur Division"
    forest_range = (
        village.forest_range
        if village and village.forest_range
        else (camera.zone_name if camera else "Bandipur Buffer")
    )

    return ResolvedLocationContext(
        has_real_location=has_real,
        camera=camera,
        village=village,
        latitude=resolved_lat,
        longitude=resolved_lng,
        location_name=clean_location,
        district=district,
        forest_range=forest_range,
    )


class NotificationChannelProvider(ABC):
    """Pluggable notification provider contract (SMS / WhatsApp / Webhook)."""

    @property
    @abstractmethod
    def provider_name(self) -> str:
        raise NotImplementedError

    @abstractmethod
    def dispatch(
        self,
        *,
        officer: ForestOfficer,
        alert: Alert,
        channel: str,
        message_body: str,
    ) -> tuple[str, str]:
        """Returns `(delivery_status, detail)` without fabricating external network delivery."""
        raise NotImplementedError


class HonestStubNotificationProvider(NotificationChannelProvider):
    """Records auditable notification dispatch state when external SMS/WhatsApp credentials are not configured."""

    def __init__(self, mode: str = "stub") -> None:
        self.mode = mode

    @property
    def provider_name(self) -> str:
        return "wicps_stub_dispatcher"

    def dispatch(
        self,
        *,
        officer: ForestOfficer,
        alert: Alert,
        channel: str,
        message_body: str,
    ) -> tuple[str, str]:
        if not officer.whatsapp_opt_in and not officer.sms_opt_in:
            return (
                "queued_provider_unconfigured",
                f"Routed to {officer.name} ({officer.badge_number}); external {channel} gateway not configured / opt-in not enabled.",
            )
        status_val = "recorded_stub" if self.mode == "stub" else "queued_provider_unconfigured"
        return (
            status_val,
            f"Recorded {channel} notification payload for {officer.name} ({officer.badge_number}) in audit log (stub mode — no external SMS/WhatsApp sent).",
        )


def _select_lead_animal(detection: AnimalDetection) -> tuple[str | None, uuid.UUID | None, str | None, float]:
    items = [d for d in (detection.detections or []) if d.get("category") == "animal"]
    if not items:
        return (None, None, None, 0.0)
    ranked = sorted(
        items,
        key=lambda x: (
            not bool(x.get("needs_review")),
            float(x.get("species_confidence", 0.0)),
            float(x.get("detector_confidence", 0.0)),
        ),
        reverse=True,
    )
    lead = ranked[0]
    species_raw = (
        None
        if lead.get("needs_review")
        else (lead.get("common_name") or lead.get("species_label"))
    )
    species_clean = canonical_species_display(species_raw) if species_raw else None
    ident_raw = lead.get("animal_identity_id")
    ident_uuid = uuid.UUID(str(ident_raw)) if ident_raw else None
    code = lead.get("animal_code")
    conf = float(lead.get("species_confidence") or 0.0)
    return (species_clean, ident_uuid, code, conf)


def link_detection_to_sighting(
    db: Session,
    *,
    detection: AnimalDetection,
    ctx: ResolvedLocationContext,
    observed_at: datetime,
    settings: Settings,
) -> tuple[Sighting | None, str]:
    """Idempotently creates or returns a Sighting for an animal detection when real location context exists."""
    if detection.animal_count <= 0:
        return (None, "no_animal_detected")
    if not ctx.has_real_location or ctx.latitude is None or ctx.longitude is None:
        return (None, "location_required_for_sighting")

    species_clean, ident_uuid, animal_code, conf = _select_lead_animal(detection)
    if not species_clean:
        return (None, "species_needs_review")

    ref_key = f"det:{detection.id}"
    existing = db.execute(
        select(Sighting).where(Sighting.external_ref_key == ref_key)
    ).scalar_one_or_none()
    if existing is not None:
        detection.generated_sighting_id = existing.id
        return (existing, "linked")

    api_prefix = settings.api_v1_prefix.rstrip("/")
    photo_url = f"{api_prefix}/detections/{detection.id}/image"
    loc_label = ctx.location_name or (ctx.village.name if ctx.village else "Reserve Perimeter")
    cam_label = f"Camera {ctx.camera.camera_code} ({ctx.camera.name})" if ctx.camera else "Field Image Upload"
    id_note = f" Individual Re-ID: {animal_code}." if animal_code else " Individual Re-ID pending review."

    sighting = Sighting(
        sighting_code=f"SIGHT-AI-{detection.id.hex[:8].upper()}",
        species=species_clean[:64],
        timestamp=observed_at,
        latitude=ctx.latitude,
        longitude=ctx.longitude,
        geom=make_point_geom(ctx.latitude, ctx.longitude, is_postgres_backend(db)),
        location_name=loc_label[:200],
        district=ctx.district[:120],
        forest_range=ctx.forest_range[:120],
        herd_size=max(1, detection.animal_count),
        movement_direction="Stationary",
        bearing_degrees=0,
        behavior="Foraging",
        juveniles_present=False,
        observation_details=(
            f"Automated SpeciesNet + MegaDescriptor pipeline detection from {cam_label} "
            f"(confidence {conf * 100:.1f}%, {detection.animal_count} animal box(es)).{id_note}"
        ),
        observer_name=cam_label[:160],
        observer_role="Automated Vision Pipeline",
        verified_by_forest_guard=False,
        photo_url=photo_url,
        is_demo=False,
        animal_detection_id=detection.id,
        animal_identity_id=ident_uuid,
        camera_id=ctx.camera.id if ctx.camera else None,
        village_id=ctx.village.id if ctx.village else None,
        external_ref_key=ref_key,
    )
    db.add(sighting)
    db.flush()
    detection.generated_sighting_id = sighting.id
    return (sighting, "linked")


def rank_officers_for_alert(
    db: Session,
    *,
    latitude: float,
    longitude: float,
    forest_range: str | None,
    district: str | None,
) -> list[tuple[ForestOfficer, str, float | None]]:
    """Ranks active officers by real GPS distance first, then forest_range match, then district."""
    officers = list(
        db.execute(
            select(ForestOfficer).where(
                ForestOfficer.on_duty.is_(True),
                ForestOfficer.notification_enabled.is_(True),
            )
        )
        .scalars()
        .all()
    )
    scored: list[tuple[int, float, ForestOfficer, str, float | None]] = []
    norm_range = (forest_range or "").strip().lower()
    norm_district = (district or "").strip().lower()

    for off in officers:
        if off.latitude is not None and off.longitude is not None:
            dist = round(haversine_km(latitude, longitude, off.latitude, off.longitude), 3)
            scored.append((0, dist, off, "gps_distance", dist))
        elif norm_range and off.forest_range.strip().lower() == norm_range:
            scored.append((1, 0.0, off, "forest_range", None))
        elif norm_district and off.district.strip().lower() == norm_district:
            scored.append((2, 0.0, off, "district_fallback", None))
        else:
            scored.append((3, 0.0, off, "division_fallback", None))

    scored.sort(key=lambda item: (item[0], item[1], item[2].name))
    return [(item[2], item[3], item[4]) for item in scored]


def route_alert_to_officers(
    db: Session,
    *,
    alert: Alert,
    forest_range: str | None,
    settings: Settings,
    provider: NotificationChannelProvider | None = None,
) -> list[AlertDeliveryAttempt]:
    """Routes an alert to the nearest/most appropriate on-duty forest officer and logs delivery attempts."""
    active_provider = provider or HonestStubNotificationProvider(settings.notification_provider_mode)
    ranked = rank_officers_for_alert(
        db,
        latitude=alert.latitude,
        longitude=alert.longitude,
        forest_range=forest_range,
        district=alert.district,
    )
    if not ranked:
        attempt = AlertDeliveryAttempt(
            alert_id=alert.id,
            officer_id=None,
            officer_name="Unassigned (No Active Officers)",
            channel="none",
            routing_basis="unassigned",
            distance_km=None,
            status="failed",
            attempt_number=1,
            detail="No on-duty notification-enabled officers exist in forest_officers table.",
        )
        db.add(attempt)
        db.flush()
        return [attempt]

    nearest_officer, basis, dist_km = ranked[0]
    alert.assigned_officer = f"{nearest_officer.name} ({nearest_officer.badge_number})"
    channel = nearest_officer.contact_channel or "whatsapp_stub"
    status_val, detail = active_provider.dispatch(
        officer=nearest_officer,
        alert=alert,
        channel=channel,
        message_body=alert.message,
    )

    attempt = AlertDeliveryAttempt(
        alert_id=alert.id,
        officer_id=nearest_officer.id,
        officer_name=nearest_officer.name,
        channel=channel,
        routing_basis=basis,
        distance_km=dist_km,
        status=status_val,
        attempt_number=1,
        detail=detail,
    )
    db.add(attempt)
    db.flush()
    return [attempt]


def dispatch_iot_boundary_event(
    db: Session,
    *,
    alert: Alert | None,
    camera: Camera | None,
    device_code: str,
    animal_identity_id: uuid.UUID | None,
    animal_code: str | None,
    species: str,
    confidence: float,
    risk_level: str,
    is_dev_test: bool,
    event_type: str = "boundary_alert_dispatch",
) -> IotEventRecord:
    """Creates a persisted IoT boundary contract event record without activating hardware sirens."""
    now = datetime.now(timezone.utc)
    payload = {
        "contract_version": "wicps.iot.boundary.v1",
        "event_type": event_type,
        "is_dev_test": is_dev_test,
        "alert_id": str(alert.id) if alert else None,
        "camera_id": str(camera.id) if camera else None,
        "device_code": device_code,
        "animal_identity_id": str(animal_identity_id) if animal_identity_id else None,
        "animal_code": animal_code,
        "species": species,
        "confidence": round(float(confidence), 4),
        "risk_level": risk_level,
        "dispatched_at": now.isoformat(),
        "hardware_actuation": "boundary_contract_only_no_siren_activated",
    }
    record = IotEventRecord(
        alert_id=alert.id if alert else None,
        camera_id=camera.id if camera else None,
        device_code=device_code,
        animal_identity_id=animal_identity_id,
        species=species,
        confidence=round(float(confidence), 4),
        risk_level=risk_level,
        event_type=event_type,
        is_dev_test=is_dev_test,
        payload_json=payload,
        delivery_status="pending_ack",
        retry_count=0,
    )
    db.add(record)
    db.flush()
    return record


def acknowledge_iot_event(
    db: Session,
    *,
    event: IotEventRecord,
    raw_camera_key: str | None,
    acknowledged_by: str | None = None,
    ack_note: str | None = None,
) -> tuple[IotEventRecord, str]:
    """Authenticates IoT device acknowledgement against registered Camera.api_key_hash."""
    if not raw_camera_key or not raw_camera_key.strip():
        raise PermissionError("Missing X-Camera-Key authentication header.")

    camera: Camera | None = db.get(Camera, event.camera_id) if event.camera_id else None
    if camera is None:
        camera = db.execute(
            select(Camera).where(Camera.camera_code == event.device_code)
        ).scalar_one_or_none()

    if camera is None:
        raise LookupError(
            f"No registered device/camera found matching '{event.device_code}' to verify X-Camera-Key."
        )

    if not verify_camera_api_key(raw_camera_key.strip(), camera.api_key_hash):
        raise PermissionError("Invalid X-Camera-Key for target boundary device.")

    now = datetime.now(timezone.utc)
    if event.delivery_status == "acknowledged" and event.acknowledged_at is not None:
        camera.last_heartbeat_at = now
        db.flush()
        return (event, camera.camera_code)

    event.delivery_status = "acknowledged"
    event.acknowledged_at = now
    event.acknowledged_by = (acknowledged_by or camera.camera_code).strip()[:160]
    event.ack_note = (
        ack_note.strip()
        if ack_note
        else f"Acknowledged via X-Camera-Key ({camera.camera_code})."
    )
    camera.last_heartbeat_at = now
    db.flush()
    return (event, camera.camera_code)


def _rule_matches_detection(
    rule: AlertRule,
    *,
    species_clean: str,
    confidence: float,
    ctx: ResolvedLocationContext,
) -> bool:
    if not rule.enabled:
        return False
    if confidence < rule.min_species_confidence:
        return False
    if rule.species_filter and rule.species_filter.strip() and rule.species_filter.strip().lower() != "all":
        f1, _ = normalize_species_family(rule.species_filter)
        f2, _ = normalize_species_family(species_clean)
        if f1 != f2 and rule.species_filter.strip().lower() != species_clean.strip().lower():
            return False
    if rule.village_id is not None:
        if ctx.village is None or ctx.village.id != rule.village_id:
            return False
    if rule.zone_name and rule.zone_name.strip():
        z_target = rule.zone_name.strip().lower()
        haystacks = [
            ctx.location_name or "",
            ctx.forest_range or "",
            ctx.village.name if ctx.village else "",
            ctx.camera.zone_name if ctx.camera else "",
        ]
        if not any(z_target in h.lower() for h in haystacks if h):
            return False
    return True


def _count_repeat_sightings(
    db: Session,
    *,
    species_clean: str,
    animal_identity_id: uuid.UUID | None,
    village_id: uuid.UUID | None,
    observed_at: datetime,
    window_minutes: int,
) -> int:
    window_start = observed_at - timedelta(minutes=max(1, window_minutes))
    stmt = select(func.count(Sighting.id)).where(
        Sighting.timestamp >= window_start,
        Sighting.timestamp <= observed_at,
    )
    if animal_identity_id is not None:
        stmt = stmt.where(Sighting.animal_identity_id == animal_identity_id)
    else:
        stmt = stmt.where(Sighting.species == species_clean)
        if village_id is not None:
            stmt = stmt.where(Sighting.village_id == village_id)
    return int(db.execute(stmt).scalar_one() or 0)


def evaluate_alert_rules_for_detection(
    db: Session,
    *,
    detection: AnimalDetection,
    sighting: Sighting | None,
    ctx: ResolvedLocationContext,
    observed_at: datetime,
    settings: Settings,
) -> list[Alert]:
    """Evaluates enabled AlertRules against a processed detection & creates idempotent Alerts."""
    if detection.animal_count <= 0 or not ctx.has_real_location:
        return []
    if ctx.latitude is None or ctx.longitude is None:
        return []

    species_clean, ident_uuid, animal_code, conf = _select_lead_animal(detection)
    if not species_clean:
        return []

    rules = list(
        db.execute(select(AlertRule).where(AlertRule.enabled.is_(True)).order_by(AlertRule.created_at.asc()))
        .scalars()
        .all()
    )
    if not rules:
        return []

    api_prefix = settings.api_v1_prefix.rstrip("/")
    image_url = f"{api_prefix}/detections/{detection.id}/image"
    affected_village = (
        ctx.village.name
        if ctx.village
        else (ctx.location_name or "Reserve Perimeter")
    )
    created_alerts: list[Alert] = []
    alert_ids: list[str] = list(detection.generated_alert_ids or [])

    for rule in rules:
        if not _rule_matches_detection(
            rule,
            species_clean=species_clean,
            confidence=conf,
            ctx=ctx,
        ):
            continue

        repeat_count = _count_repeat_sightings(
            db,
            species_clean=species_clean,
            animal_identity_id=ident_uuid,
            village_id=ctx.village.id if ctx.village else None,
            observed_at=observed_at,
            window_minutes=rule.time_window_minutes,
        )
        if sighting is None and repeat_count == 0:
            repeat_count = 1
        if repeat_count < rule.min_repeat_count:
            continue

        ext_key = f"det:{detection.id}:rule:{rule.id}"
        existing = db.execute(
            select(Alert).where(Alert.external_ref_key == ext_key)
        ).scalar_one_or_none()
        if existing is not None:
            created_alerts.append(existing)
            if str(existing.id) not in alert_ids:
                alert_ids.append(str(existing.id))
            continue

        id_label = f" [{animal_code}]" if animal_code else ""
        reason_text = (
            f"Rule '{rule.name}' triggered: {species_clean}{id_label} detected at {affected_village} "
            f"with {conf * 100:.1f}% species confidence "
            f"(repeat count={repeat_count} in {rule.time_window_minutes}m >= {rule.min_repeat_count})."
        )
        alert = Alert(
            title=f"{rule.risk_level.upper()}: {species_clean}{id_label} near {affected_village}"[:240],
            message=reason_text,
            severity=rule.risk_level,
            species=species_clean[:64],
            affected_village=affected_village[:160],
            village_id=ctx.village.id if ctx.village else None,
            district=ctx.district[:120],
            latitude=ctx.latitude,
            longitude=ctx.longitude,
            geom=make_point_geom(ctx.latitude, ctx.longitude, is_postgres_backend(db)),
            alert_time=observed_at.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            triggered_at=observed_at,
            acknowledged=False,
            assigned_officer=None,
            response_status="Pending Dispatch",
            is_demo=False,
            sighting_id=sighting.id if sighting else None,
            animal_identity_id=ident_uuid,
            animal_detection_id=detection.id,
            alert_rule_id=rule.id,
            image_url=image_url,
            risk_reason=reason_text,
            external_ref_key=ext_key,
        )
        db.add(alert)
        db.flush()

        if rule.auto_notify_officer:
            route_alert_to_officers(
                db,
                alert=alert,
                forest_range=ctx.forest_range,
                settings=settings,
            )

        if rule.auto_dispatch_iot_boundary:
            device_code = ctx.camera.camera_code if ctx.camera else f"ZONE-{ctx.forest_range[:12].upper()}"
            dispatch_iot_boundary_event(
                db,
                alert=alert,
                camera=ctx.camera,
                device_code=device_code,
                animal_identity_id=ident_uuid,
                animal_code=animal_code,
                species=species_clean,
                confidence=conf,
                risk_level=rule.risk_level,
                is_dev_test=bool(ctx.camera.is_dev_test) if ctx.camera else False,
                event_type="boundary_alert_dispatch",
            )

        created_alerts.append(alert)
        if str(alert.id) not in alert_ids:
            alert_ids.append(str(alert.id))

    detection.generated_alert_ids = alert_ids
    flag_modified(detection, "generated_alert_ids")
    return created_alerts
