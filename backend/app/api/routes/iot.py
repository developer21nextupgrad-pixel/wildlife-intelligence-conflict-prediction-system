from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_non_production, require_roles
from app.models import Alert, AnimalIdentity, Camera, IotEventRecord
from app.schemas.animal_intelligence import (
    IotAckRequest,
    IotDevTestCreate,
    IotEventResponse,
)
from app.schemas.common import PaginatedResponse
from app.services.filters import paginate_select
from app.services.wildlife_intelligence import acknowledge_iot_event, dispatch_iot_boundary_event

router = APIRouter(prefix="/iot", tags=["IoT Boundary Alert Contract"])


@router.get(
    "/events",
    response_model=PaginatedResponse[IotEventResponse],
    dependencies=[Depends(require_roles("operator"))],
)
def list_iot_events(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    delivery_status: str | None = Query(default=None),
    device_code: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> PaginatedResponse[IotEventResponse]:
    stmt = select(IotEventRecord)
    if delivery_status and delivery_status != "All":
        stmt = stmt.where(IotEventRecord.delivery_status == delivery_status)
    if device_code and device_code.strip():
        stmt = stmt.where(IotEventRecord.device_code.ilike(f"%{device_code.strip()}%"))
    stmt = stmt.order_by(IotEventRecord.created_at.desc())
    items, total, current_page, current_size, total_pages = paginate_select(
        db, stmt, page, page_size
    )
    return PaginatedResponse[IotEventResponse](
        items=[IotEventResponse.model_validate(item) for item in items],
        total=total,
        page=current_page,
        page_size=current_size,
        total_pages=total_pages,
    )


@router.post(
    "/events/dev-test",
    response_model=IotEventResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_non_production), Depends(require_roles("operator"))],
)
def dispatch_dev_test_iot_event(
    payload: IotDevTestCreate,
    db: Session = Depends(get_db),
) -> IotEventResponse:
    """Development/contract-test endpoint for IoT boundary notifications. Never actuates physical sirens."""
    camera = db.get(Camera, payload.camera_id) if payload.camera_id else None
    if payload.camera_id and not camera:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Referenced camera_id not found.",
        )
    if camera is None:
        camera = db.execute(
            select(Camera).where(Camera.camera_code == payload.device_code.strip())
        ).scalar_one_or_none()

    alert = db.get(Alert, payload.alert_id) if payload.alert_id else None
    identity = (
        db.get(AnimalIdentity, payload.animal_identity_id)
        if payload.animal_identity_id
        else None
    )

    event = dispatch_iot_boundary_event(
        db,
        alert=alert,
        camera=camera,
        device_code=camera.camera_code if camera else payload.device_code.strip(),
        animal_identity_id=identity.id if identity else payload.animal_identity_id,
        animal_code=identity.animal_code if identity else None,
        species=payload.species.strip(),
        confidence=payload.confidence,
        risk_level=payload.risk_level,
        is_dev_test=True,
        event_type="dev_test_boundary_alert",
    )
    db.commit()
    db.refresh(event)
    return IotEventResponse.model_validate(event)


@router.post("/events/{event_id}/acknowledge", response_model=IotEventResponse)
def acknowledge_iot_boundary_event(
    event_id: uuid.UUID,
    payload: IotAckRequest | None = None,
    x_camera_key: str | None = Header(default=None, alias="X-Camera-Key"),
    db: Session = Depends(get_db),
) -> IotEventResponse:
    event = db.get(IotEventRecord, event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="IoT boundary event not found.",
        )

    try:
        updated, _cam_code = acknowledge_iot_event(
            db,
            event=event,
            raw_camera_key=x_camera_key,
            acknowledged_by=payload.acknowledged_by if payload else None,
            ack_note=payload.ack_note if payload else None,
        )
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED
            if "Missing" in str(exc)
            else status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except LookupError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    db.commit()
    db.refresh(updated)
    return IotEventResponse.model_validate(updated)


@router.post(
    "/events/{event_id}/retry",
    response_model=IotEventResponse,
    dependencies=[Depends(require_roles("admin"))],
)
def retry_iot_boundary_event(
    event_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> IotEventResponse:
    event = db.get(IotEventRecord, event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="IoT boundary event not found.",
        )
    if event.delivery_status == "acknowledged":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="IoT boundary event is already acknowledged.",
        )

    event.retry_count += 1
    event.delivery_status = "pending_ack"
    db.commit()
    db.refresh(event)
    return IotEventResponse.model_validate(event)
