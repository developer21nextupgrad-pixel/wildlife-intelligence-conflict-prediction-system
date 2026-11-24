import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.database import get_db, is_postgres_backend
from app.core.security import require_roles
from app.models import Village
from app.schemas.common import PaginatedResponse
from app.schemas.village import VillageCreate, VillageResponse, VillageUpdate
from app.services.filters import apply_division_filter, paginate_select
from app.services.spatial import make_point_geom

router = APIRouter(prefix="/villages", tags=["Villages"])


@router.get(
    "",
    response_model=PaginatedResponse[VillageResponse],
    dependencies=[Depends(require_roles("operator"))],
)
def list_villages(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    division: str | None = Query(default=None),
    district: str | None = Query(default=None),
    forest_range: str | None = Query(default=None),
    risk_level: str | None = Query(default=None),
    is_demo: bool | None = Query(default=None),
    search: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> PaginatedResponse[VillageResponse]:
    stmt = select(Village)
    stmt = apply_division_filter(
        stmt,
        division or district,
        [Village.district, Village.forest_range, Village.name, Village.assigned_rrt],
    )
    if forest_range and forest_range != "All":
        stmt = stmt.where(Village.forest_range.ilike(f"%{forest_range.strip()}%"))
    if risk_level and risk_level != "All":
        stmt = stmt.where(Village.risk_level == risk_level)
    if is_demo is not None:
        stmt = stmt.where(Village.is_demo == is_demo)
    if search and search.strip():
        q = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Village.name.ilike(q),
                Village.district.ilike(q),
                Village.forest_range.ilike(q),
                Village.assigned_rrt.ilike(q),
            )
        )

    stmt = stmt.order_by(Village.risk_score.desc(), Village.name.asc())
    items, total, current_page, current_size, total_pages = paginate_select(
        db, stmt, page, page_size
    )
    return PaginatedResponse[VillageResponse](
        items=[VillageResponse.model_validate(item) for item in items],
        total=total,
        page=current_page,
        page_size=current_size,
        total_pages=total_pages,
    )


@router.get(
    "/{village_id}",
    response_model=VillageResponse,
    dependencies=[Depends(require_roles("operator"))],
)
def get_village(village_id: uuid.UUID, db: Session = Depends(get_db)) -> VillageResponse:
    record = db.get(Village, village_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Village not found.")
    return VillageResponse.model_validate(record)


@router.post(
    "",
    response_model=VillageResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles("admin"))],
)
def create_village(
    payload: VillageCreate, db: Session = Depends(get_db)
) -> VillageResponse:
    record = Village(
        name=payload.name,
        district=payload.district,
        forest_range=payload.forest_range,
        population=payload.population,
        households=payload.households,
        forest_distance_km=payload.forest_distance_km,
        latitude=payload.latitude,
        longitude=payload.longitude,
        geom=make_point_geom(payload.latitude, payload.longitude, is_postgres_backend(db)),
        risk_level=payload.risk_level,
        risk_score=payload.risk_score,
        active_solar_fence=payload.active_solar_fence,
        fence_status=payload.fence_status,
        assigned_rrt=payload.assigned_rrt,
        emergency_contact=payload.emergency_contact,
        recent_incidents_30d=payload.recent_incidents_30d,
        is_demo=False,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return VillageResponse.model_validate(record)


@router.put(
    "/{village_id}",
    response_model=VillageResponse,
    dependencies=[Depends(require_roles("admin"))],
)
def update_village(
    village_id: uuid.UUID,
    payload: VillageUpdate,
    db: Session = Depends(get_db),
) -> VillageResponse:
    record = db.get(Village, village_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Village not found.")

    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(record, field, value)

    if "latitude" in updates or "longitude" in updates:
        record.geom = make_point_geom(
            record.latitude, record.longitude, is_postgres_backend(db)
        )

    db.commit()
    db.refresh(record)
    return VillageResponse.model_validate(record)


@router.delete("/{village_id}", dependencies=[Depends(require_roles("admin"))])
def delete_village(village_id: uuid.UUID, db: Session = Depends(get_db)) -> dict[str, str]:
    record = db.get(Village, village_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Village not found.")

    db.delete(record)
    db.commit()
    return {"status": "deleted", "id": str(village_id)}
