import math
import re
from typing import Any
import uuid

from fastapi import HTTPException, status
from geoalchemy2 import WKTElement
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Alert, Incident, RiskZone, Sighting, Village
from app.schemas.common import GeoJSONFeature, GeoJSONGeometry


def make_point_geom(lat: float, lng: float, is_postgres: bool) -> WKTElement | str:
    wkt = f"POINT({lng} {lat})"
    return WKTElement(wkt, srid=4326) if is_postgres else wkt


def make_polygon_geom(
    lat_lng_coords: list[list[float]], is_postgres: bool
) -> WKTElement | str:
    if not lat_lng_coords:
        raise ValueError("Polygon coordinates cannot be empty.")

    ring = [[float(pt[1]), float(pt[0])] for pt in lat_lng_coords]
    if ring[0] != ring[-1]:
        ring.append(ring[0])

    coord_str = ", ".join(f"{lng} {lat}" for lng, lat in ring)
    wkt = f"POLYGON(({coord_str}))"
    return WKTElement(wkt, srid=4326) if is_postgres else wkt


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    earth_radius_km = 6371.0088
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)

    a = (
        math.sin(d_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return earth_radius_km * c


def resolve_village_id(
    db: Session,
    explicit_village_id: uuid.UUID | None,
    *candidate_texts: str | None,
) -> uuid.UUID | None:
    if explicit_village_id is not None:
        existing = db.get(Village, explicit_village_id)
        if not existing:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Referenced village_id does not exist.",
            )
        return existing.id

    texts = [t.strip().lower() for t in candidate_texts if t and t.strip()]
    if not texts:
        return None

    villages = list(db.execute(select(Village)).scalars().all())
    if not villages:
        return None

    # 1. Exact village name match (case-insensitive)
    for text in texts:
        for v in villages:
            if v.name.strip().lower() == text:
                return v.id

    # 2. Full village name contained in candidate text (longest match wins)
    sorted_by_name_len = sorted(villages, key=lambda v: len(v.name), reverse=True)
    for text in texts:
        for v in sorted_by_name_len:
            v_name = v.name.strip().lower()
            if v_name and v_name in text:
                return v.id

    # 3. Primary village token match (e.g. "Kadambur Pylon 54" -> "Kadambur Fringe")
    for text in texts:
        tokens = set(re.findall(r"[a-z0-9]+", text))
        for v in sorted_by_name_len:
            v_tokens = re.findall(r"[a-z0-9]+", v.name.lower())
            if v_tokens and len(v_tokens[0]) >= 4 and v_tokens[0] in tokens:
                return v.id

    # 4. Unique forest_range match if a single village belongs to that range
    for text in texts:
        range_matches = [
            v
            for v in villages
            if v.forest_range.strip()
            and (
                v.forest_range.strip().lower() == text
                or v.forest_range.strip().lower() in text
            )
        ]
        if len(range_matches) == 1:
            return range_matches[0].id

    return None


def incident_to_geojson(
    incident: Incident, distance_km: float | None = None
) -> GeoJSONFeature:
    props: dict[str, Any] = {
        "layer": "incidents",
        "id": str(incident.id),
        "incident_code": incident.incident_code,
        "species": incident.species,
        "date_time": incident.date_time.isoformat(),
        "village": incident.village,
        "district": incident.district,
        "forest_range": incident.forest_range,
        "incident_type": incident.incident_type,
        "severity": incident.severity,
        "status": incident.status,
        "human_injury": incident.human_injury,
        "crop_damage_estimated_acres": incident.crop_damage_estimated_acres,
        "is_demo": incident.is_demo,
    }
    if distance_km is not None:
        props["distance_km"] = round(distance_km, 3)

    return GeoJSONFeature(
        id=f"incident:{incident.id}",
        geometry=GeoJSONGeometry(
            type="Point",
            coordinates=[incident.longitude, incident.latitude],
        ),
        properties=props,
    )


def sighting_to_geojson(sighting: Sighting) -> GeoJSONFeature:
    return GeoJSONFeature(
        id=f"sighting:{sighting.id}",
        geometry=GeoJSONGeometry(
            type="Point",
            coordinates=[sighting.longitude, sighting.latitude],
        ),
        properties={
            "layer": "sightings",
            "id": str(sighting.id),
            "sighting_code": sighting.sighting_code,
            "species": sighting.species,
            "timestamp": sighting.timestamp.isoformat(),
            "location_name": sighting.location_name,
            "district": sighting.district,
            "forest_range": sighting.forest_range,
            "herd_size": sighting.herd_size,
            "movement_direction": sighting.movement_direction,
            "bearing_degrees": sighting.bearing_degrees,
            "behavior": sighting.behavior,
            "verified_by_forest_guard": sighting.verified_by_forest_guard,
            "is_demo": sighting.is_demo,
        },
    )


def village_to_geojson(village: Village) -> GeoJSONFeature:
    return GeoJSONFeature(
        id=f"village:{village.id}",
        geometry=GeoJSONGeometry(
            type="Point",
            coordinates=[village.longitude, village.latitude],
        ),
        properties={
            "layer": "villages",
            "id": str(village.id),
            "name": village.name,
            "district": village.district,
            "forest_range": village.forest_range,
            "risk_level": village.risk_level,
            "risk_score": village.risk_score,
            "active_solar_fence": village.active_solar_fence,
            "fence_status": village.fence_status,
            "assigned_rrt": village.assigned_rrt,
            "is_demo": village.is_demo,
        },
    )


def risk_zone_to_geojson(zone: RiskZone) -> GeoJSONFeature:
    ring = [[float(pt[1]), float(pt[0])] for pt in zone.polygon_coordinates]
    if ring and ring[0] != ring[-1]:
        ring.append(ring[0])

    return GeoJSONFeature(
        id=f"risk_zone:{zone.id}",
        geometry=GeoJSONGeometry(
            type="Polygon",
            coordinates=[ring],
        ),
        properties={
            "layer": "risk_zones",
            "id": str(zone.id),
            "name": zone.name,
            "district": zone.district,
            "forest_range": zone.forest_range,
            "risk_level": zone.risk_level,
            "risk_score": zone.risk_score,
            "dominant_species": zone.dominant_species,
            "center_lat": zone.center_lat,
            "center_lng": zone.center_lng,
            "active_alert_count": zone.active_alert_count,
            "primary_risk_factor": zone.primary_risk_factor,
            "is_demo": zone.is_demo,
        },
    )


def alert_to_geojson(alert: Alert) -> GeoJSONFeature:
    return GeoJSONFeature(
        id=f"alert:{alert.id}",
        geometry=GeoJSONGeometry(
            type="Point",
            coordinates=[alert.longitude, alert.latitude],
        ),
        properties={
            "layer": "alerts",
            "id": str(alert.id),
            "title": alert.title,
            "severity": alert.severity,
            "species": alert.species,
            "affected_village": alert.affected_village,
            "district": alert.district,
            "acknowledged": alert.acknowledged,
            "response_status": alert.response_status,
            "is_demo": alert.is_demo,
        },
    )
