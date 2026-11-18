from datetime import datetime

from fastapi import APIRouter, Depends, Query
from geoalchemy2 import Geography
from sqlalchemy import cast, func, select
from sqlalchemy.orm import Session

from app.core.database import get_db, is_postgres_backend
from app.models import Alert, Incident, RiskZone, Sighting, Village
from app.schemas.common import GeoJSONFeature, GeoJSONFeatureCollection
from app.services.filters import apply_date_window, apply_division_filter
from app.services.spatial import (
    alert_to_geojson,
    haversine_km,
    incident_to_geojson,
    risk_zone_to_geojson,
    sighting_to_geojson,
    village_to_geojson,
)

router = APIRouter(prefix="/gis", tags=["GIS Spatial"])


@router.get("/features", response_model=GeoJSONFeatureCollection)
def get_gis_features(
    layer: str | None = Query(
        default=None,
        description="Optional layer: incidents, sightings, villages, risk_zones, alerts. Note: telemetry coordinates are intentionally excluded.",
    ),
    division: str | None = Query(default=None),
    district: str | None = Query(default=None),
    species: str | None = Query(default=None),
    severity: str | None = Query(default=None),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    date_range: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> GeoJSONFeatureCollection:
    """
    Returns GeoJSON FeatureCollection across spatial layers.
    Sensitive `telemetry_records` collar GPS coordinates are strictly omitted.
    """
    active_division = division or district
    selected_layers = (
        {part.strip().lower() for part in layer.split(",") if part.strip()}
        if layer
        else {"incidents", "sightings", "villages", "risk_zones", "alerts"}
    )

    features: list[GeoJSONFeature] = []

    if "risk_zones" in selected_layers:
        rz_stmt = select(RiskZone)
        rz_stmt = apply_division_filter(
            rz_stmt, active_division, [RiskZone.district, RiskZone.forest_range, RiskZone.name]
        )
        if species and species != "All":
            rz_stmt = rz_stmt.where(RiskZone.dominant_species == species)
        if severity and severity != "All":
            rz_stmt = rz_stmt.where(RiskZone.risk_level == severity)
        for rz in db.execute(rz_stmt).scalars().all():
            features.append(risk_zone_to_geojson(rz))

    if "villages" in selected_layers:
        v_stmt = select(Village)
        v_stmt = apply_division_filter(
            v_stmt,
            active_division,
            [Village.district, Village.forest_range, Village.name, Village.assigned_rrt],
        )
        if severity and severity != "All":
            v_stmt = v_stmt.where(Village.risk_level == severity)
        for v in db.execute(v_stmt).scalars().all():
            features.append(village_to_geojson(v))

    if "incidents" in selected_layers:
        inc_stmt = select(Incident)
        inc_stmt = apply_division_filter(
            inc_stmt,
            active_division,
            [Incident.district, Incident.forest_range, Incident.village],
        )
        if species and species != "All":
            inc_stmt = inc_stmt.where(Incident.species == species)
        if severity and severity != "All":
            inc_stmt = inc_stmt.where(Incident.severity == severity)
        inc_stmt = apply_date_window(
            inc_stmt, Incident.date_time, date_from, date_to, date_range
        )
        for inc in db.execute(inc_stmt).scalars().all():
            features.append(incident_to_geojson(inc))

    if "sightings" in selected_layers:
        s_stmt = select(Sighting)
        s_stmt = apply_division_filter(
            s_stmt,
            active_division,
            [Sighting.district, Sighting.forest_range, Sighting.location_name],
        )
        if species and species != "All":
            s_stmt = s_stmt.where(Sighting.species == species)
        s_stmt = apply_date_window(
            s_stmt, Sighting.timestamp, date_from, date_to, date_range
        )
        for s in db.execute(s_stmt).scalars().all():
            features.append(sighting_to_geojson(s))

    if "alerts" in selected_layers:
        a_stmt = select(Alert)
        a_stmt = apply_division_filter(
            a_stmt,
            active_division,
            [Alert.district, Alert.affected_village, Alert.title, Alert.message],
        )
        if species and species != "All":
            a_stmt = a_stmt.where(Alert.species == species)
        if severity and severity != "All":
            a_stmt = a_stmt.where(Alert.severity == severity)
        a_stmt = apply_date_window(
            a_stmt, Alert.triggered_at, date_from, date_to, date_range
        )
        for a in db.execute(a_stmt).scalars().all():
            features.append(alert_to_geojson(a))

    return GeoJSONFeatureCollection(count=len(features), features=features)


@router.get("/risk-zones", response_model=GeoJSONFeatureCollection)
def get_gis_risk_zones(
    division: str | None = Query(default=None),
    district: str | None = Query(default=None),
    species: str | None = Query(default=None),
    severity: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> GeoJSONFeatureCollection:
    stmt = select(RiskZone)
    stmt = apply_division_filter(
        stmt, division or district, [RiskZone.district, RiskZone.forest_range, RiskZone.name]
    )
    if species and species != "All":
        stmt = stmt.where(RiskZone.dominant_species == species)
    if severity and severity != "All":
        stmt = stmt.where(RiskZone.risk_level == severity)

    zones = db.execute(stmt.order_by(RiskZone.risk_score.desc())).scalars().all()
    features = [risk_zone_to_geojson(zone) for zone in zones]
    return GeoJSONFeatureCollection(count=len(features), features=features)


@router.get("/nearby-incidents", response_model=GeoJSONFeatureCollection)
def get_nearby_incidents(
    lat: float = Query(..., ge=-90.0, le=90.0),
    lng: float = Query(..., ge=-180.0, le=180.0),
    radius_km: float = Query(default=5.0, ge=0.1, le=500.0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> GeoJSONFeatureCollection:
    features: list[GeoJSONFeature] = []

    if is_postgres_backend(db):
        target_geog = cast(
            func.ST_SetSRID(func.ST_MakePoint(lng, lat), 4326), Geography
        )
        inc_geog = cast(Incident.geom, Geography)
        distance_m = func.ST_Distance(inc_geog, target_geog).label("distance_m")

        stmt = (
            select(Incident, distance_m)
            .where(func.ST_DWithin(inc_geog, target_geog, radius_km * 1000.0))
            .order_by(distance_m.asc())
            .limit(limit)
        )
        rows = db.execute(stmt).all()
        for inc, dist_m in rows:
            features.append(
                incident_to_geojson(inc, distance_km=float(dist_m or 0.0) / 1000.0)
            )
    else:
        incidents = db.execute(select(Incident)).scalars().all()
        matched: list[tuple[Incident, float]] = []
        for inc in incidents:
            dist_km = haversine_km(lat, lng, inc.latitude, inc.longitude)
            if dist_km <= radius_km:
                matched.append((inc, dist_km))
        matched.sort(key=lambda pair: pair[1])
        for inc, dist_km in matched[:limit]:
            features.append(incident_to_geojson(inc, distance_km=dist_km))

    return GeoJSONFeatureCollection(count=len(features), features=features)
