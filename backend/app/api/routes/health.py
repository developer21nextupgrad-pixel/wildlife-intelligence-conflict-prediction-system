from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import check_database_health, get_db
from app.models import (
    Alert,
    Incident,
    Patrol,
    RiskZone,
    Sighting,
    TelemetryRecord,
    Village,
)
from app.schemas.common import DatabaseHealthResponse, HealthResponse

router = APIRouter(prefix="/health", tags=["Health"])


@router.get("", response_model=HealthResponse)
def health_check(settings: Settings = Depends(get_settings)) -> HealthResponse:
    return HealthResponse(
        status="ok",
        service=settings.app_name,
        version=settings.app_version,
        environment=settings.environment,
        timestamp=datetime.now(timezone.utc),
        telemetry_coords_exposed=False,
    )


@router.get("/database", response_model=DatabaseHealthResponse)
def database_health_check(db: Session = Depends(get_db)) -> DatabaseHealthResponse:
    try:
        db_info = check_database_health(db)
        counts = {
            "incidents": int(db.execute(select(func.count(Incident.id))).scalar_one() or 0),
            "sightings": int(db.execute(select(func.count(Sighting.id))).scalar_one() or 0),
            "villages": int(db.execute(select(func.count(Village.id))).scalar_one() or 0),
            "risk_zones": int(db.execute(select(func.count(RiskZone.id))).scalar_one() or 0),
            "alerts": int(db.execute(select(func.count(Alert.id))).scalar_one() or 0),
            "patrols": int(db.execute(select(func.count(Patrol.id))).scalar_one() or 0),
            "telemetry_records": int(
                db.execute(select(func.count(TelemetryRecord.id))).scalar_one() or 0
            ),
        }
        return DatabaseHealthResponse(
            status="ok",
            connected=db_info["connected"],
            dialect=db_info["dialect"],
            postgis_enabled=db_info["postgis_enabled"],
            postgis_version=db_info["postgis_version"],
            counts=counts,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Database health check failed: {type(exc).__name__}",
        ) from exc
