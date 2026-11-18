from datetime import datetime
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.database import get_db, is_postgres_backend
from app.models import Sighting
from app.schemas.common import PaginatedResponse
from app.schemas.sighting import SightingCreate, SightingResponse, SightingUpdate
from app.services.filters import (
    apply_date_window,
    apply_division_filter,
    paginate_select,
    resolve_bearing,
)
from app.services.spatial import make_point_geom

router = APIRouter(prefix="/sightings", tags=["Sightings"])


@router.get("", response_model=PaginatedResponse[SightingResponse])
def list_sightings(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    division: str | None = Query(default=None),
    district: str | None = Query(default=None),
    forest_range: str | None = Query(default=None),
    species: str | None = Query(default=None),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    date_range: str | None = Query(default=None),
    is_demo: bool | None = Query(default=None),
    search: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> PaginatedResponse[SightingResponse]:
    stmt = select(Sighting)
    stmt = apply_division_filter(
        stmt,
        division or district,
        [Sighting.district, Sighting.forest_range, Sighting.location_name],
    )
    if forest_range and forest_range != "All":
        stmt = stmt.where(Sighting.forest_range.ilike(f"%{forest_range.strip()}%"))
    if species and species != "All":
        stmt = stmt.where(Sighting.species == species)
    if is_demo is not None:
        stmt = stmt.where(Sighting.is_demo == is_demo)
    if search and search.strip():
        q = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Sighting.sighting_code.ilike(q),
                Sighting.species.ilike(q),
                Sighting.location_name.ilike(q),
                Sighting.forest_range.ilike(q),
                Sighting.observer_name.ilike(q),
                Sighting.observation_details.ilike(q),
            )
        )

    stmt = apply_date_window(stmt, Sighting.timestamp, date_from, date_to, date_range)
    stmt = stmt.order_by(Sighting.timestamp.desc(), Sighting.created_at.desc())

    items, total, current_page, current_size, total_pages = paginate_select(
        db, stmt, page, page_size
    )
    return PaginatedResponse[SightingResponse](
        items=[SightingResponse.model_validate(item) for item in items],
        total=total,
        page=current_page,
        page_size=current_size,
        total_pages=total_pages,
    )


@router.get("/{sighting_id}", response_model=SightingResponse)
def get_sighting(sighting_id: uuid.UUID, db: Session = Depends(get_db)) -> SightingResponse:
    record = db.get(Sighting, sighting_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sighting not found.")
    return SightingResponse.model_validate(record)


@router.post("", response_model=SightingResponse, status_code=status.HTTP_201_CREATED)
def create_sighting(
    payload: SightingCreate, db: Session = Depends(get_db)
) -> SightingResponse:
    code = (
        payload.sighting_code.strip()
        if payload.sighting_code and payload.sighting_code.strip()
        else f"SIGHT-2026-{uuid.uuid4().hex[:6].upper()}"
    )
    bearing = resolve_bearing(payload.movement_direction, payload.bearing_degrees)

    record = Sighting(
        sighting_code=code,
        species=payload.species,
        timestamp=payload.timestamp,
        latitude=payload.latitude,
        longitude=payload.longitude,
        geom=make_point_geom(payload.latitude, payload.longitude, is_postgres_backend(db)),
        location_name=payload.location_name,
        district=payload.district,
        forest_range=payload.forest_range,
        herd_size=payload.herd_size,
        movement_direction=payload.movement_direction,
        bearing_degrees=bearing,
        behavior=payload.behavior,
        juveniles_present=payload.juveniles_present,
        observation_details=payload.observation_details,
        observer_name=payload.observer_name,
        observer_role=payload.observer_role,
        verified_by_forest_guard=payload.verified_by_forest_guard,
        photo_url=payload.photo_url,
        is_demo=False,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return SightingResponse.model_validate(record)


@router.put("/{sighting_id}", response_model=SightingResponse)
def update_sighting(
    sighting_id: uuid.UUID,
    payload: SightingUpdate,
    db: Session = Depends(get_db),
) -> SightingResponse:
    record = db.get(Sighting, sighting_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sighting not found.")

    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(record, field, value)

    if "movement_direction" in updates and "bearing_degrees" not in updates:
        record.bearing_degrees = resolve_bearing(record.movement_direction, None)

    if "latitude" in updates or "longitude" in updates:
        record.geom = make_point_geom(
            record.latitude, record.longitude, is_postgres_backend(db)
        )

    db.commit()
    db.refresh(record)
    return SightingResponse.model_validate(record)


@router.delete("/{sighting_id}")
def delete_sighting(sighting_id: uuid.UUID, db: Session = Depends(get_db)) -> dict[str, str]:
    record = db.get(Sighting, sighting_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sighting not found.")

    db.delete(record)
    db.commit()
    return {"status": "deleted", "id": str(sighting_id)}
