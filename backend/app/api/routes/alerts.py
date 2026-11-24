from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.database import get_db, is_postgres_backend
from app.core.security import require_roles
from app.models import Alert
from app.schemas.alert import AlertCreate, AlertResponse, AlertUpdate
from app.schemas.common import PaginatedResponse
from app.services.filters import apply_date_window, apply_division_filter, paginate_select
from app.services.spatial import make_point_geom, resolve_village_id

router = APIRouter(prefix="/alerts", tags=["Alerts"])


@router.get(
    "",
    response_model=PaginatedResponse[AlertResponse],
    dependencies=[Depends(require_roles("operator"))],
)
def list_alerts(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    division: str | None = Query(default=None),
    district: str | None = Query(default=None),
    severity: str | None = Query(default=None),
    acknowledged: bool | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    date_range: str | None = Query(default=None),
    is_demo: bool | None = Query(default=None),
    search: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> PaginatedResponse[AlertResponse]:
    stmt = select(Alert)
    stmt = apply_division_filter(
        stmt,
        division or district,
        [Alert.district, Alert.affected_village, Alert.title, Alert.message],
    )
    if severity and severity != "All":
        stmt = stmt.where(Alert.severity == severity)
    if acknowledged is not None:
        stmt = stmt.where(Alert.acknowledged == acknowledged)
    if status_filter and status_filter != "All":
        stmt = stmt.where(Alert.response_status == status_filter)
    if is_demo is not None:
        stmt = stmt.where(Alert.is_demo == is_demo)
    if search and search.strip():
        q = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Alert.title.ilike(q),
                Alert.message.ilike(q),
                Alert.affected_village.ilike(q),
                Alert.species.ilike(q),
            )
        )

    stmt = apply_date_window(stmt, Alert.triggered_at, date_from, date_to, date_range)
    stmt = stmt.order_by(Alert.acknowledged.asc(), Alert.triggered_at.desc())

    items, total, current_page, current_size, total_pages = paginate_select(
        db, stmt, page, page_size
    )
    return PaginatedResponse[AlertResponse](
        items=[AlertResponse.model_validate(item) for item in items],
        total=total,
        page=current_page,
        page_size=current_size,
        total_pages=total_pages,
    )


@router.get(
    "/{alert_id}",
    response_model=AlertResponse,
    dependencies=[Depends(require_roles("operator"))],
)
def get_alert(alert_id: uuid.UUID, db: Session = Depends(get_db)) -> AlertResponse:
    record = db.get(Alert, alert_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found.")
    return AlertResponse.model_validate(record)


@router.post(
    "",
    response_model=AlertResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles("operator"))],
)
def create_alert(payload: AlertCreate, db: Session = Depends(get_db)) -> AlertResponse:
    now = datetime.now(timezone.utc)
    village_id = resolve_village_id(db, payload.village_id, payload.affected_village)

    triggered = payload.triggered_at or now
    alert_time = payload.alert_time or triggered.strftime("%Y-%m-%d %H:%M UTC")

    record = Alert(
        title=payload.title,
        message=payload.message,
        severity=payload.severity,
        species=payload.species,
        affected_village=payload.affected_village,
        village_id=village_id,
        district=payload.district,
        latitude=payload.latitude,
        longitude=payload.longitude,
        geom=make_point_geom(payload.latitude, payload.longitude, is_postgres_backend(db)),
        alert_time=alert_time,
        triggered_at=triggered,
        acknowledged=payload.acknowledged,
        acknowledged_by=payload.acknowledged_by,
        acknowledged_at=payload.acknowledged_at or (now if payload.acknowledged else None),
        assigned_officer=payload.assigned_officer,
        response_status=payload.response_status,
        is_demo=False,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return AlertResponse.model_validate(record)


@router.put(
    "/{alert_id}",
    response_model=AlertResponse,
    dependencies=[Depends(require_roles("operator"))],
)
def update_alert(
    alert_id: uuid.UUID,
    payload: AlertUpdate,
    db: Session = Depends(get_db),
) -> AlertResponse:
    record = db.get(Alert, alert_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found.")

    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(record, field, value)

    if "village_id" in updates:
        if updates["village_id"] is not None:
            record.village_id = resolve_village_id(db, updates["village_id"])
        elif "affected_village" in updates:
            record.village_id = resolve_village_id(db, None, record.affected_village)
    elif "affected_village" in updates:
        record.village_id = resolve_village_id(db, None, record.affected_village)

    if updates.get("acknowledged") is True and "acknowledged_at" not in updates:
        record.acknowledged_at = datetime.now(timezone.utc)
    if updates.get("acknowledged") is False and "acknowledged_at" not in updates:
        record.acknowledged_at = None

    if "latitude" in updates or "longitude" in updates:
        record.geom = make_point_geom(
            record.latitude, record.longitude, is_postgres_backend(db)
        )

    db.commit()
    db.refresh(record)
    return AlertResponse.model_validate(record)


@router.delete("/{alert_id}", dependencies=[Depends(require_roles("admin"))])
def delete_alert(alert_id: uuid.UUID, db: Session = Depends(get_db)) -> dict[str, str]:
    record = db.get(Alert, alert_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found.")

    db.delete(record)
    db.commit()
    return {"status": "deleted", "id": str(alert_id)}
