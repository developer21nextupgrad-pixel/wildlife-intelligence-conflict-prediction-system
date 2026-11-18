import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.database import get_db, is_postgres_backend
from app.models import Patrol
from app.schemas.common import PaginatedResponse
from app.schemas.patrol import PatrolCreate, PatrolResponse, PatrolUpdate
from app.services.filters import apply_division_filter, paginate_select
from app.services.spatial import make_point_geom

router = APIRouter(prefix="/patrols", tags=["Patrols"])


@router.get("", response_model=PaginatedResponse[PatrolResponse])
def list_patrols(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    division: str | None = Query(default=None),
    district: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    priority: str | None = Query(default=None),
    is_demo: bool | None = Query(default=None),
    search: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> PaginatedResponse[PatrolResponse]:
    stmt = select(Patrol)
    stmt = apply_division_filter(
        stmt,
        division or district,
        [Patrol.district, Patrol.sector, Patrol.target_area, Patrol.team_name],
    )
    if status_filter and status_filter != "All":
        stmt = stmt.where(Patrol.status == status_filter)
    if priority and priority != "All":
        stmt = stmt.where(Patrol.priority == priority)
    if is_demo is not None:
        stmt = stmt.where(Patrol.is_demo == is_demo)
    if search and search.strip():
        q = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Patrol.patrol_code.ilike(q),
                Patrol.team_name.ilike(q),
                Patrol.lead_officer.ilike(q),
                Patrol.sector.ilike(q),
                Patrol.target_area.ilike(q),
            )
        )

    stmt = stmt.order_by(Patrol.created_at.desc())
    items, total, current_page, current_size, total_pages = paginate_select(
        db, stmt, page, page_size
    )
    return PaginatedResponse[PatrolResponse](
        items=[PatrolResponse.model_validate(item) for item in items],
        total=total,
        page=current_page,
        page_size=current_size,
        total_pages=total_pages,
    )


@router.get("/{patrol_id}", response_model=PatrolResponse)
def get_patrol(patrol_id: uuid.UUID, db: Session = Depends(get_db)) -> PatrolResponse:
    record = db.get(Patrol, patrol_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patrol not found.")
    return PatrolResponse.model_validate(record)


@router.post("", response_model=PatrolResponse, status_code=status.HTTP_201_CREATED)
def create_patrol(
    payload: PatrolCreate, db: Session = Depends(get_db)
) -> PatrolResponse:
    code = (
        payload.patrol_code.strip()
        if payload.patrol_code and payload.patrol_code.strip()
        else f"PTR-2026-{uuid.uuid4().hex[:6].upper()}"
    )

    record = Patrol(
        patrol_code=code,
        team_name=payload.team_name,
        lead_officer=payload.lead_officer,
        target_area=payload.target_area,
        sector=payload.sector,
        district=payload.district,
        village_id=payload.village_id,
        priority=payload.priority,
        status=payload.status,
        scheduled_window=payload.scheduled_window,
        active_personnel=payload.active_personnel,
        equipment=payload.equipment,
        risk_rationale=payload.risk_rationale,
        approved_by=payload.approved_by,
        latitude=payload.latitude,
        longitude=payload.longitude,
        geom=make_point_geom(payload.latitude, payload.longitude, is_postgres_backend(db)),
        is_demo=False,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return PatrolResponse.model_validate(record)


@router.put("/{patrol_id}", response_model=PatrolResponse)
def update_patrol(
    patrol_id: uuid.UUID,
    payload: PatrolUpdate,
    db: Session = Depends(get_db),
) -> PatrolResponse:
    record = db.get(Patrol, patrol_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patrol not found.")

    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(record, field, value)

    if "latitude" in updates or "longitude" in updates:
        record.geom = make_point_geom(
            record.latitude, record.longitude, is_postgres_backend(db)
        )

    db.commit()
    db.refresh(record)
    return PatrolResponse.model_validate(record)


@router.delete("/{patrol_id}")
def delete_patrol(patrol_id: uuid.UUID, db: Session = Depends(get_db)) -> dict[str, str]:
    record = db.get(Patrol, patrol_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patrol not found.")

    db.delete(record)
    db.commit()
    return {"status": "deleted", "id": str(patrol_id)}
