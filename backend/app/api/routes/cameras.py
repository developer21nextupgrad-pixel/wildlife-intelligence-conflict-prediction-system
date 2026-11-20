from datetime import datetime, timezone
import logging
from typing import Any
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from app.core.database import get_db, is_postgres_backend
from app.models import Camera, ThermalFrame, Village
from app.schemas.camera import (
    CameraCreate,
    CameraCreateResponse,
    CameraHeartbeatRequest,
    CameraResponse,
    CameraUpdate,
)
from app.schemas.common import PaginatedResponse
from app.services.camera_security import (
    generate_camera_api_key,
    hash_camera_api_key,
    mask_stream_metadata,
    verify_camera_api_key,
)
from app.services.filters import paginate_select
from app.services.spatial import make_point_geom, resolve_village_id

logger = logging.getLogger("wicps.cameras")

router = APIRouter(prefix="/cameras", tags=["Thermal Cameras"])


@router.get("", response_model=PaginatedResponse[CameraResponse])
def list_cameras(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    zone_type: str | None = Query(default=None),
    protocol: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    is_dev_test: bool | None = Query(default=None),
    search: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> PaginatedResponse[CameraResponse]:
    stmt = select(Camera)
    if zone_type and zone_type != "All":
        stmt = stmt.where(Camera.zone_type == zone_type)
    if protocol and protocol != "All":
        stmt = stmt.where(Camera.protocol == protocol)
    if status_filter and status_filter != "All":
        stmt = stmt.where(Camera.status == status_filter)
    if is_dev_test is not None:
        stmt = stmt.where(Camera.is_dev_test == is_dev_test)
    if search and search.strip():
        q = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Camera.camera_code.ilike(q),
                Camera.name.ilike(q),
                Camera.zone_name.ilike(q),
            )
        )

    stmt = stmt.order_by(Camera.is_dev_test.asc(), Camera.created_at.desc())
    items, total, current_page, current_size, total_pages = paginate_select(
        db, stmt, page, page_size
    )
    return PaginatedResponse[CameraResponse](
        items=[CameraResponse.model_validate(item) for item in items],
        total=total,
        page=current_page,
        page_size=current_size,
        total_pages=total_pages,
    )


@router.post("", response_model=CameraCreateResponse, status_code=status.HTTP_201_CREATED)
def register_camera(
    payload: CameraCreate,
    db: Session = Depends(get_db),
) -> CameraCreateResponse:
    existing = db.execute(
        select(Camera).where(Camera.camera_code == payload.camera_code)
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Camera code '{payload.camera_code}' is already registered.",
        )

    village_id: uuid.UUID | None = None
    if payload.village_id is not None:
        existing_village = db.get(Village, payload.village_id)
        if existing_village is not None:
            village_id = existing_village.id
        elif payload.village_name:
            village_id = resolve_village_id(db, None, payload.village_name)
            has_villages = db.execute(select(Village.id).limit(1)).first() is not None
            if village_id is None and has_villages:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Referenced village_id does not exist.",
                )
        else:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Referenced village_id does not exist.",
            )
    else:
        village_id = resolve_village_id(db, None, payload.village_name, payload.zone_name)

    plaintext_key = generate_camera_api_key()
    sanitized_meta = mask_stream_metadata(payload.stream_metadata)
    if village_id is None and payload.village_name and "village_name" not in sanitized_meta:
        sanitized_meta["village_name"] = payload.village_name.strip()

    record = Camera(
        camera_code=payload.camera_code,
        name=payload.name,
        village_id=village_id,
        zone_name=payload.zone_name,
        zone_type=payload.zone_type,
        latitude=payload.latitude,
        longitude=payload.longitude,
        geom=make_point_geom(payload.latitude, payload.longitude, is_postgres_backend(db)),
        protocol=payload.protocol,
        stream_metadata=sanitized_meta,
        status=payload.status,
        api_key_hash=hash_camera_api_key(plaintext_key),
        is_dev_test=payload.is_dev_test,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    logger.info(
        "Registered thermal camera camera_code=%s protocol=%s is_dev_test=%s",
        record.camera_code,
        record.protocol,
        record.is_dev_test,
    )

    base = CameraResponse.model_validate(record).model_dump()
    return CameraCreateResponse(**base, api_key=plaintext_key)


@router.patch("/{camera_id}", response_model=CameraResponse)
def update_camera(
    camera_id: uuid.UUID,
    payload: CameraUpdate,
    db: Session = Depends(get_db),
) -> CameraResponse:
    record = db.get(Camera, camera_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera not found.")

    updates = payload.model_dump(exclude_unset=True)
    if "village_id" in updates and updates["village_id"] is not None:
        updates["village_id"] = resolve_village_id(db, updates["village_id"])
    if "stream_metadata" in updates:
        updates["stream_metadata"] = mask_stream_metadata(updates["stream_metadata"])

    for field, value in updates.items():
        setattr(record, field, value)

    if "latitude" in updates or "longitude" in updates:
        record.geom = make_point_geom(
            record.latitude, record.longitude, is_postgres_backend(db)
        )

    db.commit()
    db.refresh(record)
    return CameraResponse.model_validate(record)


@router.post("/{camera_id}/heartbeat", response_model=CameraResponse)
def camera_heartbeat(
    camera_id: uuid.UUID,
    payload: CameraHeartbeatRequest | None = None,
    x_camera_key: str | None = Header(default=None, alias="X-Camera-Key"),
    db: Session = Depends(get_db),
) -> CameraResponse:
    record = db.get(Camera, camera_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera not found.")

    if not x_camera_key or not verify_camera_api_key(x_camera_key, record.api_key_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-Camera-Key authentication header.",
        )

    record.last_heartbeat_at = datetime.now(timezone.utc)
    if payload:
        if payload.status is not None:
            record.status = payload.status
        if payload.stream_metadata is not None:
            merged = dict(record.stream_metadata or {})
            merged.update(mask_stream_metadata(payload.stream_metadata))
            record.stream_metadata = merged

    db.commit()
    db.refresh(record)
    return CameraResponse.model_validate(record)


@router.delete("/{camera_id}")
def delete_camera(camera_id: uuid.UUID, db: Session = Depends(get_db)) -> dict[str, Any]:
    record = db.get(Camera, camera_id)
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Camera not found.",
        )

    preserved_result = db.execute(
        update(ThermalFrame)
        .where(ThermalFrame.camera_id == record.id)
        .values(
            camera_code_snapshot=record.camera_code,
            camera_name_snapshot=record.name,
            zone_name_snapshot=record.zone_name,
            camera_id=None,
        )
    )
    preserved_frames = int(preserved_result.rowcount or 0)
    deleted_code = record.camera_code

    db.delete(record)
    db.commit()

    logger.info(
        "Deleted thermal camera camera_code=%s id=%s preserved_frames=%d",
        deleted_code,
        camera_id,
        preserved_frames,
    )
    return {
        "status": "deleted",
        "id": str(camera_id),
        "camera_code": deleted_code,
        "preserved_frames": preserved_frames,
    }

