from datetime import datetime
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.database import get_db, is_postgres_backend
from app.models import Incident, Village
from app.schemas.common import PaginatedResponse
from app.schemas.incident import IncidentCreate, IncidentResponse, IncidentUpdate
from app.services.filters import apply_date_window, apply_division_filter, paginate_select
from app.services.spatial import make_point_geom

router = APIRouter(prefix="/incidents", tags=["Incidents"])


@router.get("", response_model=PaginatedResponse[IncidentResponse])
def list_incidents(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    division: str | None = Query(default=None),
    district: str | None = Query(default=None),
    forest_range: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    species: str | None = Query(default=None),
    severity: str | None = Query(default=None),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    date_range: str | None = Query(default=None),
    is_demo: bool | None = Query(default=None),
    search: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> PaginatedResponse[IncidentResponse]:
    stmt = select(Incident)
    stmt = apply_division_filter(
        stmt,
        division or district,
        [Incident.district, Incident.forest_range, Incident.village],
    )
    if forest_range and forest_range != "All":
        stmt = stmt.where(Incident.forest_range.ilike(f"%{forest_range.strip()}%"))
    if status_filter and status_filter != "All":
        stmt = stmt.where(Incident.status == status_filter)
    if species and species != "All":
        stmt = stmt.where(Incident.species == species)
    if severity and severity != "All":
        stmt = stmt.where(Incident.severity == severity)
    if is_demo is not None:
        stmt = stmt.where(Incident.is_demo == is_demo)
    if search and search.strip():
        q = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Incident.incident_code.ilike(q),
                Incident.species.ilike(q),
                Incident.village.ilike(q),
                Incident.forest_range.ilike(q),
                Incident.description.ilike(q),
                Incident.incident_type.ilike(q),
            )
        )

    stmt = apply_date_window(stmt, Incident.date_time, date_from, date_to, date_range)
    stmt = stmt.order_by(Incident.date_time.desc(), Incident.created_at.desc())

    items, total, current_page, current_size, total_pages = paginate_select(
        db, stmt, page, page_size
    )
    return PaginatedResponse[IncidentResponse](
        items=[IncidentResponse.model_validate(item) for item in items],
        total=total,
        page=current_page,
        page_size=current_size,
        total_pages=total_pages,
    )


@router.get("/{incident_id}", response_model=IncidentResponse)
def get_incident(incident_id: uuid.UUID, db: Session = Depends(get_db)) -> IncidentResponse:
    record = db.get(Incident, incident_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found.")
    return IncidentResponse.model_validate(record)


@router.post("", response_model=IncidentResponse, status_code=status.HTTP_201_CREATED)
def create_incident(
    payload: IncidentCreate, db: Session = Depends(get_db)
) -> IncidentResponse:
    village_id = payload.village_id
    if village_id is None:
        matched_village = db.execute(
            select(Village).where(func.lower(Village.name) == payload.village.strip().lower())
        ).scalar_one_or_none()
        if matched_village:
            village_id = matched_village.id

    code = (
        payload.incident_code.strip()
        if payload.incident_code and payload.incident_code.strip()
        else f"WICPS-2026-{uuid.uuid4().hex[:6].upper()}"
    )

    record = Incident(
        incident_code=code,
        species=payload.species,
        date_time=payload.date_time,
        latitude=payload.latitude,
        longitude=payload.longitude,
        geom=make_point_geom(payload.latitude, payload.longitude, is_postgres_backend(db)),
        village_id=village_id,
        village=payload.village,
        district=payload.district,
        forest_range=payload.forest_range,
        incident_type=payload.incident_type,
        severity=payload.severity,
        human_injury=payload.human_injury,
        human_injuries_count=payload.human_injuries_count,
        livestock_loss_count=payload.livestock_loss_count,
        crop_damage_estimated_acres=payload.crop_damage_estimated_acres,
        crop_type=payload.crop_type,
        description=payload.description,
        image_url=payload.image_url,
        status=payload.status,
        reported_by=payload.reported_by,
        assigned_officer=payload.assigned_officer,
        action_taken=payload.action_taken,
        is_demo=False,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return IncidentResponse.model_validate(record)


@router.put("/{incident_id}", response_model=IncidentResponse)
def update_incident(
    incident_id: uuid.UUID,
    payload: IncidentUpdate,
    db: Session = Depends(get_db),
) -> IncidentResponse:
    record = db.get(Incident, incident_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found.")

    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(record, field, value)

    if "latitude" in updates or "longitude" in updates:
        record.geom = make_point_geom(
            record.latitude, record.longitude, is_postgres_backend(db)
        )

    db.commit()
    db.refresh(record)
    return IncidentResponse.model_validate(record)


@router.delete("/{incident_id}")
def delete_incident(incident_id: uuid.UUID, db: Session = Depends(get_db)) -> dict[str, str]:
    record = db.get(Incident, incident_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found.")

    db.delete(record)
    db.commit()
    return {"status": "deleted", "id": str(incident_id)}
