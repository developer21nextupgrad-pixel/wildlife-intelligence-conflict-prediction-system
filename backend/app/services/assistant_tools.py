"""Read-only, parameterized WICPS intelligence tools for the AI Wildlife Intelligence Assistant.

Security guarantees:
- Strictly READ-ONLY: only parameterized SQLAlchemy SELECT queries are executed.
- Zero raw SQL strings or LLM-generated query fragments.
- Excludes personal contact data (officer phone/email, user accounts, password hashes)
  and protected wildlife telemetry GPS coordinates.
- Returns verified database records and verified map coordinates for GIS integration.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from sqlalchemy import desc, or_, select
from sqlalchemy.orm import Session

from app.core.security import AuthenticatedPrincipal
from app.models import (
    Alert,
    AnimalDetection,
    AnimalIdentity,
    Incident,
    Patrol,
    RiskZone,
    Sighting,
    Village,
)
from app.schemas.assistant import AssistantMapLocation
from app.services.filters import apply_division_filter
from app.services.spatial import haversine_km

_SEVERITY_ORDER = {"Critical": 4, "High": 3, "Moderate": 2, "Medium": 2, "Low": 1}


@dataclass(frozen=True)
class ToolExecutionOutput:
    tool_name: str
    source_label: str
    record_count: int
    payload: dict[str, Any]
    map_locations: list[AssistantMapLocation]


def _clamp_int(raw: Any, default: int, min_val: int, max_val: int) -> int:
    try:
        val = int(raw)
    except (TypeError, ValueError):
        return default
    return max(min_val, min(max_val, val))


def _clamp_float(raw: Any, default: float, min_val: float, max_val: float) -> float:
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return default
    return max(min_val, min(max_val, val))


def _clean_text(raw: Any, max_len: int = 120) -> str | None:
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    return text[:max_len]


def _normalize_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    norm = _normalize_utc(dt)
    return norm.isoformat() if norm else None


def _matches_species(record_species: str | None, query_species: str | None) -> bool:
    if not query_species:
        return True
    q = query_species.strip().lower()
    if not q or q == "all":
        return True
    return q in (record_species or "").strip().lower()


def _matches_text(value: str | None, query: str | None) -> bool:
    if not query:
        return True
    q = query.strip().lower()
    if not q or q == "all":
        return True
    return q in (value or "").strip().lower()


def _village_map_loc(v: Village, subtitle: str | None = None) -> AssistantMapLocation:
    return AssistantMapLocation(
        id=f"village:{v.id}",
        label=v.name,
        kind="village",
        latitude=float(v.latitude),
        longitude=float(v.longitude),
        district=v.district,
        risk_level=v.risk_level,
        risk_score=int(v.risk_score),
        subtitle=subtitle or f"{v.forest_range} • Risk {v.risk_score}%",
    )


def _risk_zone_map_loc(z: RiskZone) -> AssistantMapLocation:
    return AssistantMapLocation(
        id=f"risk_zone:{z.id}",
        label=z.name,
        kind="risk_zone",
        latitude=float(z.center_lat),
        longitude=float(z.center_lng),
        district=z.district,
        risk_level=z.risk_level,
        risk_score=int(z.risk_score),
        subtitle=f"{z.dominant_species} • {z.active_alert_count} active alerts",
    )


def _incident_map_loc(inc: Incident) -> AssistantMapLocation:
    return AssistantMapLocation(
        id=f"incident:{inc.id}",
        label=f"{inc.incident_code} — {inc.village}",
        kind="incident",
        latitude=float(inc.latitude),
        longitude=float(inc.longitude),
        district=inc.district,
        risk_level=inc.severity,
        subtitle=f"{inc.species} • {inc.incident_type}",
    )


def _alert_map_loc(a: Alert) -> AssistantMapLocation:
    return AssistantMapLocation(
        id=f"alert:{a.id}",
        label=f"{a.affected_village} ({a.severity})",
        kind="alert",
        latitude=float(a.latitude),
        longitude=float(a.longitude),
        district=a.district,
        risk_level=a.severity,
        subtitle=a.title[:100],
    )


def _sighting_map_loc(s: Sighting) -> AssistantMapLocation:
    return AssistantMapLocation(
        id=f"sighting:{s.id}",
        label=f"{s.species} at {s.location_name}",
        kind="sighting",
        latitude=float(s.latitude),
        longitude=float(s.longitude),
        district=s.district,
        subtitle=f"Herd: {s.herd_size} • Moving {s.movement_direction}",
    )


# ---------------------------------------------------------------------------
# Controlled Read-Only WICPS Intelligence Tools
# ---------------------------------------------------------------------------


def tool_get_high_risk_villages(
    db: Session,
    args: dict[str, Any],
    _principal: AuthenticatedPrincipal,
) -> ToolExecutionOutput:
    limit = _clamp_int(args.get("limit"), 5, 1, 20)
    species = _clean_text(args.get("species"), 64)
    district = _clean_text(args.get("district"), 120)
    min_risk_score = (
        _clamp_int(args.get("min_risk_score"), 0, 0, 100)
        if args.get("min_risk_score") is not None
        else None
    )

    stmt = select(Village)
    stmt = apply_division_filter(
        stmt, district, [Village.district, Village.forest_range, Village.name]
    )
    if min_risk_score is not None:
        stmt = stmt.where(Village.risk_score >= min_risk_score)
    villages = list(db.execute(stmt).scalars().all())

    # Cross-reference incidents and risk zones for species-specific context
    incidents = list(db.execute(select(Incident)).scalars().all())
    risk_zones = list(db.execute(select(RiskZone)).scalars().all())
    alerts = list(db.execute(select(Alert).where(Alert.acknowledged.is_(False))).scalars().all())

    enriched: list[tuple[tuple[int, int, int], dict[str, Any], Village]] = []
    for v in villages:
        v_name_l = v.name.strip().lower()
        v_incidents = [
            inc
            for inc in incidents
            if (inc.village_id == v.id or inc.village.strip().lower() == v_name_l)
        ]
        sp_incidents = [inc for inc in v_incidents if _matches_species(inc.species, species)]
        v_zones = [
            z
            for z in risk_zones
            if z.village_id == v.id
            or v_name_l in z.name.lower()
            or z.forest_range.strip().lower() == v.forest_range.strip().lower()
        ]
        sp_zones = [z for z in v_zones if _matches_species(z.dominant_species, species)]
        v_alerts = [
            a
            for a in alerts
            if a.village_id == v.id or a.affected_village.strip().lower() == v_name_l
        ]

        if species:
            species_relevance = (1 if sp_incidents or sp_zones else 0)
            sort_key = (species_relevance, len(sp_incidents) * 15 + int(v.risk_score), int(v.recent_incidents_30d))
        else:
            sort_key = (1, int(v.risk_score), int(v.recent_incidents_30d))

        entry = {
            "village_name": v.name,
            "district": v.district,
            "forest_range": v.forest_range,
            "risk_level": v.risk_level,
            "risk_score": int(v.risk_score),
            "forest_distance_km": round(float(v.forest_distance_km), 2),
            "recent_incidents_30d": int(v.recent_incidents_30d),
            "recorded_total_incidents": len(v_incidents),
            "species_matched_incidents": len(sp_incidents) if species else len(v_incidents),
            "unresolved_alerts": len(v_alerts),
            "active_solar_fence": bool(v.active_solar_fence),
            "fence_status": v.fence_status,
            "assigned_rrt": v.assigned_rrt,
            "population": int(v.population),
            "households": int(v.households),
            "matching_risk_zones": [
                {
                    "name": z.name,
                    "dominant_species": z.dominant_species,
                    "risk_score": int(z.risk_score),
                    "primary_risk_factor": z.primary_risk_factor,
                }
                for z in (sp_zones if species and sp_zones else v_zones)[:3]
            ],
            "latitude": float(v.latitude),
            "longitude": float(v.longitude),
        }
        enriched.append((sort_key, entry, v))

    enriched.sort(key=lambda item: item[0], reverse=True)
    top_items = enriched[:limit]

    locations = [
        _village_map_loc(
            v,
            subtitle=(
                f"{entry['risk_level']} ({entry['risk_score']}%) • "
                f"{entry['species_matched_incidents']} {species or 'total'} incidents"
            ),
        )
        for _, entry, v in top_items
    ]

    return ToolExecutionOutput(
        tool_name="get_high_risk_villages",
        source_label="Villages & Risk Profiles",
        record_count=len(top_items),
        payload={
            "filter_species": species,
            "filter_district": district,
            "total_villages_evaluated": len(villages),
            "villages": [entry for _, entry, _ in top_items],
        },
        map_locations=locations,
    )


def tool_get_incident_summary(
    db: Session,
    args: dict[str, Any],
    _principal: AuthenticatedPrincipal,
) -> ToolExecutionOutput:
    days = _clamp_int(args.get("days"), 30, 1, 3650) if args.get("days") is not None else 30
    species = _clean_text(args.get("species"), 64)
    district = _clean_text(args.get("district"), 120)
    village = _clean_text(args.get("village"), 160)
    severity = _clean_text(args.get("severity"), 32)
    status_filter = _clean_text(args.get("status"), 48)
    limit = _clamp_int(args.get("limit"), 15, 1, 25)

    stmt = select(Incident).order_by(desc(Incident.date_time))
    stmt = apply_division_filter(
        stmt, district, [Incident.district, Incident.forest_range, Incident.village]
    )
    all_matching = list(db.execute(stmt).scalars().all())

    filtered_all_time = [
        inc
        for inc in all_matching
        if _matches_species(inc.species, species)
        and _matches_text(inc.village, village)
        and _matches_text(inc.severity, severity)
        and _matches_text(inc.status, status_filter)
    ]

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)
    in_window = [
        inc
        for inc in filtered_all_time
        if (_normalize_utc(inc.date_time) or now) >= cutoff
    ]

    def _summarize(rows: list[Incident]) -> dict[str, Any]:
        by_species = Counter(r.species for r in rows)
        by_severity = Counter(r.severity for r in rows)
        by_district = Counter(r.district for r in rows)
        by_village = Counter(r.village for r in rows)
        by_range = Counter(r.forest_range for r in rows)
        by_status = Counter(r.status for r in rows)
        return {
            "count": len(rows),
            "total_human_injuries": sum(int(r.human_injuries_count or 0) for r in rows),
            "total_livestock_loss": sum(int(r.livestock_loss_count or 0) for r in rows),
            "total_crop_damage_acres": round(
                sum(float(r.crop_damage_estimated_acres or 0.0) for r in rows), 2
            ),
            "by_species": dict(by_species.most_common(10)),
            "by_severity": dict(by_severity),
            "by_district": dict(by_district.most_common(10)),
            "by_forest_range": dict(by_range.most_common(10)),
            "top_villages": [
                {"village": name, "incident_count": cnt}
                for name, cnt in by_village.most_common(10)
            ],
            "by_status": dict(by_status),
        }

    selected_rows = in_window if in_window else filtered_all_time
    recent_records = [
        {
            "incident_code": r.incident_code,
            "date_time": _iso(r.date_time),
            "species": r.species,
            "village": r.village,
            "district": r.district,
            "forest_range": r.forest_range,
            "incident_type": r.incident_type,
            "severity": r.severity,
            "status": r.status,
            "human_injuries_count": int(r.human_injuries_count or 0),
            "livestock_loss_count": int(r.livestock_loss_count or 0),
            "crop_damage_estimated_acres": round(float(r.crop_damage_estimated_acres or 0.0), 2),
            "description": (r.description or "")[:240],
        }
        for r in selected_rows[:limit]
    ]

    earliest = _iso(filtered_all_time[-1].date_time) if filtered_all_time else None
    latest = _iso(filtered_all_time[0].date_time) if filtered_all_time else None

    locations = [_incident_map_loc(r) for r in selected_rows[:8]]

    return ToolExecutionOutput(
        tool_name="get_incident_summary",
        source_label="Conflict Incidents",
        record_count=len(in_window),
        payload={
            "window_days": days,
            "filters": {
                "species": species,
                "district": district,
                "village": village,
                "severity": severity,
                "status": status_filter,
            },
            "window_summary": _summarize(in_window),
            "all_time_matching_count": len(filtered_all_time),
            "all_time_date_range": {"earliest": earliest, "latest": latest},
            "all_time_summary_fallback_note": (
                f"No incidents occurred strictly within the last {days} days; showing all {len(filtered_all_time)} matching historical records for context."
                if not in_window and filtered_all_time
                else None
            ),
            "records": recent_records,
        },
        map_locations=locations,
    )


def tool_get_recent_sightings(
    db: Session,
    args: dict[str, Any],
    _principal: AuthenticatedPrincipal,
) -> ToolExecutionOutput:
    days = _clamp_int(args.get("days"), 30, 1, 3650) if args.get("days") is not None else 30
    species = _clean_text(args.get("species"), 64)
    village_name = _clean_text(args.get("village"), 160)
    district = _clean_text(args.get("district"), 120)
    radius_km = _clamp_float(args.get("radius_km"), 15.0, 0.5, 100.0)
    limit = _clamp_int(args.get("limit"), 15, 1, 25)

    target_village: Village | None = None
    if village_name:
        villages = list(db.execute(select(Village)).scalars().all())
        vn_l = village_name.lower()
        target_village = next(
            (v for v in villages if v.name.strip().lower() == vn_l),
            None,
        ) or next(
            (v for v in villages if vn_l in v.name.strip().lower() or v.name.strip().lower() in vn_l),
            None,
        )

    stmt = select(Sighting).order_by(desc(Sighting.timestamp))
    stmt = apply_division_filter(
        stmt, district, [Sighting.district, Sighting.forest_range, Sighting.location_name]
    )
    all_sightings = list(db.execute(stmt).scalars().all())

    matched_all_time: list[tuple[Sighting, float | None]] = []
    for s in all_sightings:
        if not _matches_species(s.species, species):
            continue
        dist_km: float | None = None
        if target_village is not None:
            dist_km = haversine_km(
                float(target_village.latitude),
                float(target_village.longitude),
                float(s.latitude),
                float(s.longitude),
            )
            is_linked = (
                s.village_id == target_village.id
                or target_village.name.lower() in (s.location_name or "").lower()
                or dist_km <= radius_km
            )
            if not is_linked:
                continue
        elif village_name:
            if village_name.lower() not in (s.location_name or "").lower() and village_name.lower() not in (s.forest_range or "").lower():
                continue
        matched_all_time.append((s, dist_km))

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)
    in_window = [
        (s, d) for s, d in matched_all_time if (_normalize_utc(s.timestamp) or now) >= cutoff
    ]
    selected = in_window if in_window else matched_all_time

    directions = Counter(s.movement_direction for s, _ in selected)
    behaviors = Counter(s.behavior for s, _ in selected)
    species_counts = Counter(s.species for s, _ in selected)

    records = [
        {
            "sighting_code": s.sighting_code,
            "timestamp": _iso(s.timestamp),
            "species": s.species,
            "location_name": s.location_name,
            "district": s.district,
            "forest_range": s.forest_range,
            "herd_size": int(s.herd_size),
            "movement_direction": s.movement_direction,
            "bearing_degrees": int(s.bearing_degrees),
            "behavior": s.behavior,
            "juveniles_present": bool(s.juveniles_present),
            "verified_by_forest_guard": bool(s.verified_by_forest_guard),
            "distance_from_village_km": round(d, 2) if d is not None else None,
            "observation_details": (s.observation_details or "")[:240],
        }
        for s, d in selected[:limit]
    ]

    locations = [_sighting_map_loc(s) for s, _ in selected[:8]]
    if target_village is not None:
        locations.insert(0, _village_map_loc(target_village))

    return ToolExecutionOutput(
        tool_name="get_recent_sightings",
        source_label="Animal Sightings",
        record_count=len(in_window),
        payload={
            "window_days": days,
            "matched_village": target_village.name if target_village else village_name,
            "radius_km": radius_km if target_village else None,
            "window_count": len(in_window),
            "all_time_matching_count": len(matched_all_time),
            "movement_direction_summary": dict(directions.most_common(8)),
            "behavior_summary": dict(behaviors.most_common(8)),
            "species_breakdown": dict(species_counts.most_common(8)),
            "all_time_fallback_note": (
                f"No sightings occurred strictly within the last {days} days; showing all {len(matched_all_time)} matching recorded sightings."
                if not in_window and matched_all_time
                else None
            ),
            "sightings": records,
        },
        map_locations=locations,
    )


def tool_get_active_alerts(
    db: Session,
    args: dict[str, Any],
    _principal: AuthenticatedPrincipal,
) -> ToolExecutionOutput:
    severity = _clean_text(args.get("severity"), 32)
    species = _clean_text(args.get("species"), 64)
    district = _clean_text(args.get("district"), 120)
    include_resolved = bool(args.get("include_resolved", False))
    limit = _clamp_int(args.get("limit"), 15, 1, 25)

    stmt = select(Alert).order_by(desc(Alert.triggered_at))
    stmt = apply_division_filter(
        stmt, district, [Alert.district, Alert.affected_village, Alert.title]
    )
    rows = list(db.execute(stmt).scalars().all())

    filtered: list[Alert] = []
    for a in rows:
        is_unresolved = (not a.acknowledged) or (a.response_status or "").strip().lower() != "resolved"
        if not include_resolved and not is_unresolved:
            continue
        if not _matches_text(a.severity, severity):
            continue
        if not _matches_species(a.species, species):
            continue
        filtered.append(a)

    filtered.sort(
        key=lambda a: (
            0 if not a.acknowledged else 1,
            -_SEVERITY_ORDER.get(a.severity, 0),
            -(_normalize_utc(a.triggered_at) or datetime.min.replace(tzinfo=timezone.utc)).timestamp(),
        )
    )

    records = [
        {
            "title": a.title,
            "severity": a.severity,
            "species": a.species,
            "affected_village": a.affected_village,
            "district": a.district,
            "acknowledged": bool(a.acknowledged),
            "response_status": a.response_status,
            "assigned_officer": a.assigned_officer,
            "triggered_at": _iso(a.triggered_at),
            "alert_time": a.alert_time,
            "risk_reason": a.risk_reason or (a.message or "")[:240],
        }
        for a in filtered[:limit]
    ]

    locations = [_alert_map_loc(a) for a in filtered[:8]]

    return ToolExecutionOutput(
        tool_name="get_active_alerts",
        source_label="Active Alerts",
        record_count=len(filtered),
        payload={
            "include_resolved": include_resolved,
            "total_matching_alerts": len(filtered),
            "unacknowledged_count": sum(1 for a in filtered if not a.acknowledged),
            "by_severity": dict(Counter(a.severity for a in filtered)),
            "alerts": records,
        },
        map_locations=locations,
    )


def tool_get_risk_predictions(
    db: Session,
    args: dict[str, Any],
    _principal: AuthenticatedPrincipal,
) -> ToolExecutionOutput:
    window_hours = _clamp_int(args.get("window_hours"), 48, 6, 336)
    species = _clean_text(args.get("species"), 64)
    district = _clean_text(args.get("district"), 120)
    limit = _clamp_int(args.get("limit"), 8, 1, 20)

    zone_stmt = select(RiskZone).order_by(desc(RiskZone.risk_score))
    zone_stmt = apply_division_filter(
        zone_stmt, district, [RiskZone.district, RiskZone.forest_range, RiskZone.name]
    )
    zones = [
        z for z in db.execute(zone_stmt).scalars().all() if _matches_species(z.dominant_species, species)
    ]

    village_stmt = select(Village).order_by(desc(Village.risk_score))
    village_stmt = apply_division_filter(
        village_stmt, district, [Village.district, Village.forest_range, Village.name]
    )
    villages = list(db.execute(village_stmt).scalars().all())

    alert_stmt = select(Alert).where(Alert.acknowledged.is_(False)).order_by(desc(Alert.triggered_at))
    alert_stmt = apply_division_filter(
        alert_stmt, district, [Alert.district, Alert.affected_village]
    )
    active_alerts = [
        a for a in db.execute(alert_stmt).scalars().all() if _matches_species(a.species, species)
    ]

    sighting_stmt = select(Sighting).order_by(desc(Sighting.timestamp))
    sighting_stmt = apply_division_filter(
        sighting_stmt, district, [Sighting.district, Sighting.forest_range, Sighting.location_name]
    )
    recent_sightings = [
        s for s in db.execute(sighting_stmt).scalars().all() if _matches_species(s.species, species)
    ][:10]

    locations: list[AssistantMapLocation] = []
    for z in zones[:limit]:
        locations.append(_risk_zone_map_loc(z))
    for v in villages[:5]:
        locations.append(_village_map_loc(v))

    return ToolExecutionOutput(
        tool_name="get_risk_predictions",
        source_label="Risk Zones & Operational Risk Outlook",
        record_count=len(zones) + len(villages[:limit]),
        payload={
            "requested_window_hours": window_hours,
            "live_ml_forecast_available": False,
            "weather_data_available": False,
            "prediction_engine_note": (
                "WICPS does not currently run a live backend ML or weather-driven 24h/48h/72h "
                "forecast model (the frontend Conflict Prediction screen uses a client-side demo "
                "heuristic estimator). The hotspots below are grounded strictly in current database "
                "Risk Zones, Village vulnerability scores, unresolved Alerts, and recent Sightings."
            ),
            "high_risk_zones": [
                {
                    "name": z.name,
                    "district": z.district,
                    "forest_range": z.forest_range,
                    "risk_level": z.risk_level,
                    "risk_score": int(z.risk_score),
                    "dominant_species": z.dominant_species,
                    "active_alert_count": int(z.active_alert_count),
                    "primary_risk_factor": z.primary_risk_factor,
                }
                for z in zones[:limit]
            ],
            "highest_risk_villages": [
                {
                    "name": v.name,
                    "district": v.district,
                    "forest_range": v.forest_range,
                    "risk_level": v.risk_level,
                    "risk_score": int(v.risk_score),
                    "recent_incidents_30d": int(v.recent_incidents_30d),
                    "fence_status": v.fence_status,
                    "active_solar_fence": bool(v.active_solar_fence),
                    "assigned_rrt": v.assigned_rrt,
                }
                for v in villages[:limit]
            ],
            "active_unresolved_alerts": [
                {
                    "title": a.title,
                    "severity": a.severity,
                    "species": a.species,
                    "affected_village": a.affected_village,
                    "triggered_at": _iso(a.triggered_at),
                }
                for a in active_alerts[:8]
            ],
            "latest_sighting_movements": [
                {
                    "species": s.species,
                    "location_name": s.location_name,
                    "herd_size": int(s.herd_size),
                    "movement_direction": s.movement_direction,
                    "behavior": s.behavior,
                    "timestamp": _iso(s.timestamp),
                }
                for s in recent_sightings[:6]
            ],
        },
        map_locations=locations,
    )


def tool_get_village_risk_details(
    db: Session,
    args: dict[str, Any],
    _principal: AuthenticatedPrincipal,
) -> ToolExecutionOutput:
    village_name = _clean_text(args.get("village_name"), 160)
    villages = list(db.execute(select(Village).order_by(desc(Village.risk_score))).scalars().all())
    if not village_name:
        return ToolExecutionOutput(
            tool_name="get_village_risk_details",
            source_label="Village Risk Profile",
            record_count=0,
            payload={
                "found": False,
                "error": "No village_name was provided.",
                "available_villages": [v.name for v in villages[:15]],
            },
            map_locations=[],
        )

    vn_l = village_name.lower()
    matched = next(
        (v for v in villages if v.name.strip().lower() == vn_l),
        None,
    ) or next(
        (v for v in villages if vn_l in v.name.strip().lower() or v.name.strip().lower() in vn_l),
        None,
    )

    if matched is None:
        return ToolExecutionOutput(
            tool_name="get_village_risk_details",
            source_label="Village Risk Profile",
            record_count=0,
            payload={
                "found": False,
                "queried_village": village_name,
                "available_villages": [v.name for v in villages[:20]],
            },
            map_locations=[],
        )

    v_name_l = matched.name.strip().lower()
    incidents = [
        inc
        for inc in db.execute(select(Incident).order_by(desc(Incident.date_time))).scalars().all()
        if inc.village_id == matched.id or inc.village.strip().lower() == v_name_l
    ]
    zones = [
        z
        for z in db.execute(select(RiskZone).order_by(desc(RiskZone.risk_score))).scalars().all()
        if z.village_id == matched.id
        or v_name_l in z.name.lower()
        or z.forest_range.strip().lower() == matched.forest_range.strip().lower()
    ]
    alerts = [
        a
        for a in db.execute(select(Alert).order_by(desc(Alert.triggered_at))).scalars().all()
        if a.village_id == matched.id or a.affected_village.strip().lower() == v_name_l
    ]
    sightings = [
        s
        for s in db.execute(select(Sighting).order_by(desc(Sighting.timestamp))).scalars().all()
        if s.village_id == matched.id
        or v_name_l in s.location_name.lower()
        or haversine_km(float(matched.latitude), float(matched.longitude), float(s.latitude), float(s.longitude)) <= 12.0
    ]
    patrols = [
        p
        for p in db.execute(select(Patrol)).scalars().all()
        if p.village_id == matched.id
        or v_name_l in p.target_area.lower()
        or matched.forest_range.lower() in p.sector.lower()
    ]

    risk_drivers: list[str] = []
    if float(matched.forest_distance_km) <= 2.0:
        risk_drivers.append(
            f"Close forest boundary proximity ({matched.forest_distance_km} km from reserve boundary)."
        )
    if not matched.active_solar_fence or (matched.fence_status or "").lower() != "operational":
        risk_drivers.append(
            f"Perimeter barrier gap: solar fence active={matched.active_solar_fence}, status='{matched.fence_status}'."
        )
    if int(matched.recent_incidents_30d) > 0:
        risk_drivers.append(f"{matched.recent_incidents_30d} recent conflict incidents recorded in the 30-day profile.")
    for z in zones[:3]:
        risk_drivers.append(f"Overlapping risk zone '{z.name}' ({z.dominant_species}): {z.primary_risk_factor}")

    locations = [_village_map_loc(matched)]
    locations.extend(_risk_zone_map_loc(z) for z in zones[:3])

    return ToolExecutionOutput(
        tool_name="get_village_risk_details",
        source_label=f"Village Profile: {matched.name}",
        record_count=1 + len(incidents) + len(zones) + len(alerts),
        payload={
            "found": True,
            "village": {
                "name": matched.name,
                "district": matched.district,
                "forest_range": matched.forest_range,
                "risk_level": matched.risk_level,
                "risk_score": int(matched.risk_score),
                "population": int(matched.population),
                "households": int(matched.households),
                "forest_distance_km": round(float(matched.forest_distance_km), 2),
                "active_solar_fence": bool(matched.active_solar_fence),
                "fence_status": matched.fence_status,
                "assigned_rrt": matched.assigned_rrt,
                "recent_incidents_30d": int(matched.recent_incidents_30d),
                "latitude": float(matched.latitude),
                "longitude": float(matched.longitude),
            },
            "identified_risk_drivers": risk_drivers,
            "overlapping_risk_zones": [
                {
                    "name": z.name,
                    "risk_level": z.risk_level,
                    "risk_score": int(z.risk_score),
                    "dominant_species": z.dominant_species,
                    "primary_risk_factor": z.primary_risk_factor,
                }
                for z in zones[:5]
            ],
            "recent_incidents": [
                {
                    "incident_code": i.incident_code,
                    "date_time": _iso(i.date_time),
                    "species": i.species,
                    "incident_type": i.incident_type,
                    "severity": i.severity,
                    "status": i.status,
                    "crop_damage_estimated_acres": round(float(i.crop_damage_estimated_acres or 0.0), 2),
                }
                for i in incidents[:8]
            ],
            "nearby_sightings_count": len(sightings),
            "nearby_sightings": [
                {
                    "sighting_code": s.sighting_code,
                    "species": s.species,
                    "location_name": s.location_name,
                    "herd_size": int(s.herd_size),
                    "movement_direction": s.movement_direction,
                    "timestamp": _iso(s.timestamp),
                }
                for s in sightings[:5]
            ],
            "alerts_count": len(alerts),
            "unresolved_alerts_count": sum(1 for a in alerts if not a.acknowledged),
            "assigned_patrols": [
                {
                    "patrol_code": p.patrol_code,
                    "team_name": p.team_name,
                    "status": p.status,
                    "priority": p.priority,
                    "scheduled_window": p.scheduled_window,
                }
                for p in patrols[:5]
            ],
        },
        map_locations=locations,
    )


def tool_compare_district_incidents(
    db: Session,
    args: dict[str, Any],
    _principal: AuthenticatedPrincipal,
) -> ToolExecutionOutput:
    district_a = _clean_text(args.get("district_a"), 120) or ""
    district_b = _clean_text(args.get("district_b"), 120) or ""
    days = _clamp_int(args.get("days"), 90, 1, 3650) if args.get("days") is not None else 90
    species = _clean_text(args.get("species"), 64)

    all_incidents = list(db.execute(select(Incident)).scalars().all())
    all_villages = list(db.execute(select(Village)).scalars().all())
    all_alerts = list(db.execute(select(Alert)).scalars().all())

    available_districts = sorted(
        {
            *(i.district for i in all_incidents if i.district),
            *(v.district for v in all_villages if v.district),
        }
    )
    available_ranges = sorted(
        {
            *(i.forest_range for i in all_incidents if i.forest_range),
            *(v.forest_range for v in all_villages if v.forest_range),
        }
    )

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)

    def _stats_for(area: str) -> dict[str, Any]:
        if not area:
            return {"area": area, "incident_count": 0}
        inc_stmt = apply_division_filter(
            select(Incident), area, [Incident.district, Incident.forest_range, Incident.village]
        )
        matched_all = [
            i for i in db.execute(inc_stmt).scalars().all() if _matches_species(i.species, species)
        ]
        matched_window = [
            i for i in matched_all if (_normalize_utc(i.date_time) or now) >= cutoff
        ]
        v_stmt = apply_division_filter(
            select(Village), area, [Village.district, Village.forest_range, Village.name]
        )
        matched_villages = list(db.execute(v_stmt).scalars().all())
        a_stmt = apply_division_filter(
            select(Alert), area, [Alert.district, Alert.affected_village]
        )
        matched_alerts = [a for a in db.execute(a_stmt).scalars().all() if not a.acknowledged]

        return {
            "area": area,
            "incidents_in_window": len(matched_window),
            "incidents_all_time": len(matched_all),
            "by_severity_all_time": dict(Counter(i.severity for i in matched_all)),
            "by_species_all_time": dict(Counter(i.species for i in matched_all)),
            "total_crop_damage_acres": round(
                sum(float(i.crop_damage_estimated_acres or 0.0) for i in matched_all), 2
            ),
            "total_livestock_loss": sum(int(i.livestock_loss_count or 0) for i in matched_all),
            "total_human_injuries": sum(int(i.human_injuries_count or 0) for i in matched_all),
            "villages_count": len(matched_villages),
            "high_or_critical_villages": sum(
                1 for v in matched_villages if v.risk_level in {"High", "Critical"}
            ),
            "unresolved_alerts": len(matched_alerts),
        }

    stats_a = _stats_for(district_a)
    stats_b = _stats_for(district_b)

    return ToolExecutionOutput(
        tool_name="compare_district_incidents",
        source_label="District / Range Comparison",
        record_count=int(stats_a.get("incidents_all_time", 0)) + int(stats_b.get("incidents_all_time", 0)),
        payload={
            "window_days": days,
            "filter_species": species,
            "comparison": [stats_a, stats_b],
            "available_districts_in_db": available_districts,
            "available_forest_ranges_in_db": available_ranges,
        },
        map_locations=[],
    )


def tool_get_patrol_summary(
    db: Session,
    args: dict[str, Any],
    _principal: AuthenticatedPrincipal,
) -> ToolExecutionOutput:
    district = _clean_text(args.get("district"), 120)
    status_filter = _clean_text(args.get("status"), 48)
    priority_filter = _clean_text(args.get("priority"), 32)
    limit = _clamp_int(args.get("limit"), 15, 1, 25)

    stmt = select(Patrol).order_by(desc(Patrol.created_at))
    stmt = apply_division_filter(
        stmt, district, [Patrol.district, Patrol.sector, Patrol.target_area]
    )
    patrols = [
        p
        for p in db.execute(stmt).scalars().all()
        if _matches_text(p.status, status_filter) and _matches_text(p.priority, priority_filter)
    ]

    # Identify high-risk villages and risk zones needing additional patrols
    villages = list(
        db.execute(
            apply_division_filter(
                select(Village).order_by(desc(Village.risk_score)),
                district,
                [Village.district, Village.forest_range, Village.name],
            )
        ).scalars().all()
    )
    unresolved_alerts = list(
        db.execute(select(Alert).where(Alert.acknowledged.is_(False))).scalars().all()
    )

    active_patrols = [
        p for p in patrols if (p.status or "").strip().lower() in {"active", "dispatched", "en route", "in progress"}
    ]
    patrol_gaps: list[dict[str, Any]] = []
    gap_locations: list[AssistantMapLocation] = []
    for v in villages:
        if v.risk_level not in {"Critical", "High"} and int(v.risk_score) < 60:
            continue
        v_name_l = v.name.lower()
        covering = [
            p
            for p in active_patrols
            if p.village_id == v.id
            or v_name_l in p.target_area.lower()
            or v.forest_range.lower() in p.sector.lower()
        ]
        v_alerts = [
            a
            for a in unresolved_alerts
            if a.village_id == v.id or a.affected_village.strip().lower() == v_name_l
        ]
        if len(covering) == 0 or len(v_alerts) > len(covering):
            patrol_gaps.append(
                {
                    "village_name": v.name,
                    "district": v.district,
                    "forest_range": v.forest_range,
                    "risk_level": v.risk_level,
                    "risk_score": int(v.risk_score),
                    "recent_incidents_30d": int(v.recent_incidents_30d),
                    "unresolved_alerts": len(v_alerts),
                    "active_patrols_covering": len(covering),
                    "fence_status": v.fence_status,
                    "assigned_rrt": v.assigned_rrt,
                }
            )
            gap_locations.append(
                _village_map_loc(
                    v,
                    subtitle=f"Patrol gap • {len(covering)} active patrols, {len(v_alerts)} unresolved alerts",
                )
            )

    return ToolExecutionOutput(
        tool_name="get_patrol_summary",
        source_label="Patrol Operations & Coverage Gaps",
        record_count=len(patrols),
        payload={
            "total_patrols": len(patrols),
            "by_status": dict(Counter(p.status for p in patrols)),
            "by_priority": dict(Counter(p.priority for p in patrols)),
            "total_active_personnel": sum(int(p.active_personnel or 0) for p in active_patrols),
            "patrols": [
                {
                    "patrol_code": p.patrol_code,
                    "team_name": p.team_name,
                    "target_area": p.target_area,
                    "sector": p.sector,
                    "district": p.district,
                    "priority": p.priority,
                    "status": p.status,
                    "scheduled_window": p.scheduled_window,
                    "active_personnel": int(p.active_personnel),
                    "risk_rationale": (p.risk_rationale or "")[:200],
                }
                for p in patrols[:limit]
            ],
            "areas_needing_additional_patrols": patrol_gaps[:10],
        },
        map_locations=gap_locations[:8],
    )


def tool_get_recent_detections_summary(
    db: Session,
    args: dict[str, Any],
    _principal: AuthenticatedPrincipal,
) -> ToolExecutionOutput:
    days = _clamp_int(args.get("days"), 30, 1, 3650) if args.get("days") is not None else 30
    species = _clean_text(args.get("species"), 64)
    limit = _clamp_int(args.get("limit"), 15, 1, 25)

    detections = [
        d
        for d in db.execute(
            select(AnimalDetection)
            .where(AnimalDetection.is_deleted.is_(False))
            .order_by(desc(AnimalDetection.created_at))
        ).scalars().all()
        if _matches_species(d.primary_species or d.primary_common_name, species)
    ]

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)
    in_window = [
        d for d in detections if (_normalize_utc(d.captured_at or d.created_at) or now) >= cutoff
    ]
    selected = in_window if in_window else detections

    identities = [
        aid
        for aid in db.execute(
            select(AnimalIdentity).order_by(desc(AnimalIdentity.last_seen_at))
        ).scalars().all()
        if _matches_species(aid.species, species)
    ]

    return ToolExecutionOutput(
        tool_name="get_recent_detections_summary",
        source_label="Camera AI Detections & Re-ID",
        record_count=len(selected),
        payload={
            "window_days": days,
            "detections_in_window": len(in_window),
            "detections_all_time": len(detections),
            "species_breakdown": dict(
                Counter((d.primary_common_name or d.primary_species or "Unknown") for d in selected)
            ),
            "recent_detections": [
                {
                    "created_at": _iso(d.captured_at or d.created_at),
                    "primary_species": d.primary_common_name or d.primary_species,
                    "scientific_name": d.primary_scientific_name,
                    "confidence": round(float(d.primary_confidence), 3)
                    if d.primary_confidence is not None
                    else None,
                    "animal_count": int(d.animal_count),
                    "location_name": d.location_name,
                    "processing_status": d.processing_status,
                }
                for d in selected[:limit]
            ],
            "tracked_individual_identities": [
                {
                    "animal_code": aid.animal_code,
                    "species": aid.species,
                    "verification_status": aid.verification_status,
                    "total_sightings": int(aid.total_sightings),
                    "last_seen_at": _iso(aid.last_seen_at),
                }
                for aid in identities[:10]
            ],
        },
        map_locations=[],
    )


def tool_get_daily_intelligence_brief(
    db: Session,
    args: dict[str, Any],
    _principal: AuthenticatedPrincipal,
) -> ToolExecutionOutput:
    district = _clean_text(args.get("district"), 120)
    now = datetime.now(timezone.utc)
    c24 = now - timedelta(hours=24)
    c7 = now - timedelta(days=7)
    c30 = now - timedelta(days=30)

    incidents = list(
        db.execute(
            apply_division_filter(
                select(Incident).order_by(desc(Incident.date_time)),
                district,
                [Incident.district, Incident.forest_range, Incident.village],
            )
        ).scalars().all()
    )
    sightings = list(
        db.execute(
            apply_division_filter(
                select(Sighting).order_by(desc(Sighting.timestamp)),
                district,
                [Sighting.district, Sighting.forest_range, Sighting.location_name],
            )
        ).scalars().all()
    )
    alerts = list(
        db.execute(
            apply_division_filter(
                select(Alert).order_by(desc(Alert.triggered_at)),
                district,
                [Alert.district, Alert.affected_village],
            )
        ).scalars().all()
    )
    villages = list(
        db.execute(
            apply_division_filter(
                select(Village).order_by(desc(Village.risk_score)),
                district,
                [Village.district, Village.forest_range, Village.name],
            )
        ).scalars().all()
    )
    risk_zones = list(
        db.execute(
            apply_division_filter(
                select(RiskZone).order_by(desc(RiskZone.risk_score)),
                district,
                [RiskZone.district, RiskZone.forest_range, RiskZone.name],
            )
        ).scalars().all()
    )
    patrols = list(
        db.execute(
            apply_division_filter(
                select(Patrol),
                district,
                [Patrol.district, Patrol.sector, Patrol.target_area],
            )
        ).scalars().all()
    )
    detections_count = len(
        db.execute(
            select(AnimalDetection).where(AnimalDetection.is_deleted.is_(False))
        ).scalars().all()
    )

    unresolved_alerts = [
        a for a in alerts if (not a.acknowledged) or (a.response_status or "").lower() != "resolved"
    ]

    locations = [_village_map_loc(v) for v in villages[:5]]
    locations.extend(_risk_zone_map_loc(z) for z in risk_zones[:3])

    return ToolExecutionOutput(
        tool_name="get_daily_intelligence_brief",
        source_label="WICPS Operational Intelligence Brief",
        record_count=len(incidents) + len(sightings) + len(alerts) + len(villages),
        payload={
            "generated_at_utc": now.isoformat(),
            "filter_district": district or "All Divisions",
            "incidents": {
                "last_24h": sum(1 for i in incidents if (_normalize_utc(i.date_time) or now) >= c24),
                "last_7d": sum(1 for i in incidents if (_normalize_utc(i.date_time) or now) >= c7),
                "last_30d": sum(1 for i in incidents if (_normalize_utc(i.date_time) or now) >= c30),
                "total_recorded": len(incidents),
                "latest_incidents": [
                    {
                        "incident_code": i.incident_code,
                        "species": i.species,
                        "village": i.village,
                        "severity": i.severity,
                        "status": i.status,
                        "date_time": _iso(i.date_time),
                    }
                    for i in incidents[:5]
                ],
            },
            "sightings": {
                "last_24h": sum(1 for s in sightings if (_normalize_utc(s.timestamp) or now) >= c24),
                "last_7d": sum(1 for s in sightings if (_normalize_utc(s.timestamp) or now) >= c7),
                "total_recorded": len(sightings),
                "latest_sightings": [
                    {
                        "species": s.species,
                        "location_name": s.location_name,
                        "herd_size": int(s.herd_size),
                        "movement_direction": s.movement_direction,
                        "timestamp": _iso(s.timestamp),
                    }
                    for s in sightings[:5]
                ],
            },
            "alerts": {
                "unresolved_count": len(unresolved_alerts),
                "unacknowledged_count": sum(1 for a in alerts if not a.acknowledged),
                "by_severity": dict(Counter(a.severity for a in unresolved_alerts)),
                "top_unresolved": [
                    {
                        "title": a.title,
                        "severity": a.severity,
                        "species": a.species,
                        "affected_village": a.affected_village,
                        "response_status": a.response_status,
                    }
                    for a in unresolved_alerts[:5]
                ],
            },
            "top_risk_villages": [
                {
                    "name": v.name,
                    "district": v.district,
                    "risk_level": v.risk_level,
                    "risk_score": int(v.risk_score),
                    "recent_incidents_30d": int(v.recent_incidents_30d),
                    "fence_status": v.fence_status,
                }
                for v in villages[:5]
            ],
            "top_risk_zones": [
                {
                    "name": z.name,
                    "risk_level": z.risk_level,
                    "risk_score": int(z.risk_score),
                    "dominant_species": z.dominant_species,
                    "primary_risk_factor": z.primary_risk_factor,
                }
                for z in risk_zones[:4]
            ],
            "patrols": {
                "total": len(patrols),
                "by_status": dict(Counter(p.status for p in patrols)),
            },
            "camera_detections_total": detections_count,
        },
        map_locations=locations,
    )


ToolHandler = Callable[[Session, dict[str, Any], AuthenticatedPrincipal], ToolExecutionOutput]

TOOL_HANDLERS: dict[str, ToolHandler] = {
    "get_high_risk_villages": tool_get_high_risk_villages,
    "get_incident_summary": tool_get_incident_summary,
    "get_recent_sightings": tool_get_recent_sightings,
    "get_active_alerts": tool_get_active_alerts,
    "get_risk_predictions": tool_get_risk_predictions,
    "get_village_risk_details": tool_get_village_risk_details,
    "compare_district_incidents": tool_compare_district_incidents,
    "get_patrol_summary": tool_get_patrol_summary,
    "get_recent_detections_summary": tool_get_recent_detections_summary,
    "get_daily_intelligence_brief": tool_get_daily_intelligence_brief,
}


GEMINI_FUNCTION_DECLARATIONS: list[dict[str, Any]] = [
    {
        "name": "get_high_risk_villages",
        "description": (
            "Retrieve villages ranked by conflict risk score from WICPS. Optionally filter or "
            "prioritize by species (e.g., 'Asian Elephant', 'Bengal Tiger', 'Indian Leopard') or district/range."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "limit": {"type": "INTEGER", "description": "Number of villages to return (1-20, default 5)."},
                "species": {"type": "STRING", "description": "Optional species filter, e.g. 'Asian Elephant' or 'Elephant'."},
                "district": {"type": "STRING", "description": "Optional district or forest range name."},
                "min_risk_score": {"type": "INTEGER", "description": "Optional minimum risk score (0-100)."},
            },
        },
    },
    {
        "name": "get_incident_summary",
        "description": (
            "Summarize wildlife conflict incidents over a given number of days with counts by village, "
            "district, forest range, species, severity, status, crop damage, livestock loss, and injuries."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "days": {"type": "INTEGER", "description": "Lookback window in days (default 30)."},
                "species": {"type": "STRING", "description": "Optional species filter."},
                "district": {"type": "STRING", "description": "Optional district or range filter."},
                "village": {"type": "STRING", "description": "Optional village name filter."},
                "severity": {"type": "STRING", "description": "Optional severity filter (Critical, High, Moderate, Low)."},
                "status": {"type": "STRING", "description": "Optional status filter."},
                "limit": {"type": "INTEGER", "description": "Maximum individual records to return (default 15)."},
            },
        },
    },
    {
        "name": "get_recent_sightings",
        "description": (
            "Retrieve recent animal sightings and movement patterns (direction, bearing, herd size, behavior). "
            "Can filter by species, district, or proximity around a specific village."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "days": {"type": "INTEGER", "description": "Lookback window in days (default 30)."},
                "species": {"type": "STRING", "description": "Optional species filter, e.g. 'Elephant'."},
                "village": {"type": "STRING", "description": "Optional village name to find nearby sightings."},
                "district": {"type": "STRING", "description": "Optional district or range filter."},
                "radius_km": {"type": "NUMBER", "description": "Search radius in km around the village (default 15)."},
                "limit": {"type": "INTEGER", "description": "Maximum records to return (default 15)."},
            },
        },
    },
    {
        "name": "get_active_alerts",
        "description": (
            "Retrieve unresolved or unacknowledged wildlife alerts requiring forest department attention."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "severity": {"type": "STRING", "description": "Optional severity filter (Critical, High, Moderate, Low)."},
                "species": {"type": "STRING", "description": "Optional species filter."},
                "district": {"type": "STRING", "description": "Optional district or range filter."},
                "include_resolved": {"type": "BOOLEAN", "description": "Include resolved alerts if true (default false)."},
                "limit": {"type": "INTEGER", "description": "Maximum alerts to return (default 15)."},
            },
        },
    },
    {
        "name": "get_risk_predictions",
        "description": (
            "Retrieve current highest-risk zones, vulnerable villages, unresolved alerts, and latest movement "
            "trends for near-term operational risk outlook (e.g., next 24/48/72 hours). Also reports exact "
            "prediction engine capability status."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "window_hours": {"type": "INTEGER", "description": "Requested outlook window in hours (e.g., 24, 48, 72)."},
                "species": {"type": "STRING", "description": "Optional species filter."},
                "district": {"type": "STRING", "description": "Optional district or range filter."},
                "limit": {"type": "INTEGER", "description": "Maximum risk zones/villages to return (default 8)."},
            },
        },
    },
    {
        "name": "get_village_risk_details",
        "description": (
            "Explain why a specific village has its risk score by retrieving its full profile, forest distance, "
            "solar fence status, overlapping risk zones, incidents, nearby sightings, alerts, and patrols."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "village_name": {"type": "STRING", "description": "Name of the village to inspect."},
            },
            "required": ["village_name"],
        },
    },
    {
        "name": "compare_district_incidents",
        "description": (
            "Compare wildlife conflict incidents, severities, crop/livestock impacts, high-risk villages, "
            "and unresolved alerts between two districts or forest ranges."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "district_a": {"type": "STRING", "description": "First district or forest range name."},
                "district_b": {"type": "STRING", "description": "Second district or forest range name."},
                "days": {"type": "INTEGER", "description": "Lookback window in days (default 90)."},
                "species": {"type": "STRING", "description": "Optional species filter."},
            },
            "required": ["district_a", "district_b"],
        },
    },
    {
        "name": "get_patrol_summary",
        "description": (
            "Summarize active and scheduled forest patrol deployments and identify high-risk villages or "
            "sectors that have patrol coverage gaps and need additional forest patrols."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "district": {"type": "STRING", "description": "Optional district or range filter."},
                "status": {"type": "STRING", "description": "Optional patrol status filter."},
                "priority": {"type": "STRING", "description": "Optional patrol priority filter."},
                "limit": {"type": "INTEGER", "description": "Maximum patrols to return (default 15)."},
            },
        },
    },
    {
        "name": "get_recent_detections_summary",
        "description": (
            "Summarize recent AI camera-trap animal detections and individually re-identified animals (Re-ID)."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "days": {"type": "INTEGER", "description": "Lookback window in days (default 30)."},
                "species": {"type": "STRING", "description": "Optional species filter."},
                "limit": {"type": "INTEGER", "description": "Maximum detections to return (default 15)."},
            },
        },
    },
    {
        "name": "get_daily_intelligence_brief",
        "description": (
            "Generate a comprehensive operational summary of today's wildlife intelligence across incidents, "
            "sightings, unresolved alerts, top risk villages, risk zones, patrols, and camera detections."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "district": {"type": "STRING", "description": "Optional district or range filter."},
            },
        },
    },
]


def execute_readonly_tool(
    db: Session,
    tool_name: str,
    arguments: dict[str, Any] | None,
    principal: AuthenticatedPrincipal,
) -> ToolExecutionOutput:
    handler = TOOL_HANDLERS.get(tool_name)
    if handler is None:
        return ToolExecutionOutput(
            tool_name=tool_name,
            source_label="Unsupported Tool",
            record_count=0,
            payload={
                "error": f"Tool '{tool_name}' is not allowed. Only approved read-only WICPS tools may be called.",
                "allowed_tools": sorted(TOOL_HANDLERS.keys()),
            },
            map_locations=[],
        )
    safe_args = arguments if isinstance(arguments, dict) else {}
    return handler(db, safe_args, principal)
