from datetime import datetime, timezone
import io
import json
import logging
from pathlib import Path
from typing import Literal
import uuid

import cv2
import numpy as np
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from PIL import Image
from pydantic import ValidationError
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db, is_postgres_backend
from app.models import Camera, ThermalFrame
from app.schemas.common import PaginatedResponse
from app.schemas.ingest import (
    DevSampleIngestResponse,
    HttpFrameIngestionMetadata,
    RtspTestPullRequest,
    RtspTestPullResponse,
    ThermalFrameResponse,
)
from app.services.camera_security import (
    generate_camera_api_key,
    hash_camera_api_key,
    mask_url_credentials,
    verify_camera_api_key,
)
from app.services.filters import apply_date_window, paginate_select
from app.services.frame_processor import (
    FrameProcessingOutcome,
    MediaLimitError,
    RtspConnectionError,
    SUPPORTED_IMAGE_EXTENSIONS,
    SUPPORTED_VIDEO_EXTENSIONS,
    UnsupportedMediaError,
    process_image_bytes,
    process_video_bytes,
    test_pull_rtsp_stream,
)
from app.services.spatial import make_point_geom
from app.services.storage import ObjectStorageBackend, get_storage_backend

logger = logging.getLogger("wicps.ingest")

router = APIRouter(prefix="/ingest", tags=["Thermal Ingestion"])

DEV_CAMERA_CODE = "DEV-SAMPLE-CAM-01"


def _frame_to_response(
    frame: ThermalFrame, camera: Camera | None = None
) -> ThermalFrameResponse:
    return ThermalFrameResponse(
        id=frame.id,
        camera_id=frame.camera_id,
        camera_code=camera.camera_code if camera else frame.camera_code_snapshot,
        camera_name=camera.name if camera else frame.camera_name_snapshot,
        zone_name=camera.zone_name if camera else frame.zone_name_snapshot,
        capture_mode=frame.capture_mode,
        source_filename=frame.source_filename,
        captured_at=frame.captured_at,
        frame_index=frame.frame_index,
        width=frame.width,
        height=frame.height,
        pixel_format=frame.pixel_format,
        qc_passed=frame.qc_passed,
        qc_metrics=frame.qc_metrics or {},
        rejection_reason=frame.rejection_reason,
        raw_object_key=frame.raw_object_key,
        processed_object_key=frame.processed_object_key,
        processing_status=frame.processing_status,
        is_dev_test=frame.is_dev_test,
        created_at=frame.created_at,
        updated_at=frame.updated_at,
    )


def _persist_frame_outcome(
    db: Session,
    storage: ObjectStorageBackend,
    camera: Camera,
    outcome: FrameProcessingOutcome,
    *,
    capture_mode: str,
    source_filename: str | None,
    is_dev_test: bool,
) -> ThermalFrame:
    frame_id = uuid.uuid4()
    date_prefix = outcome.captured_at.astimezone(timezone.utc).strftime("%Y-%m-%d")
    raw_key = storage.put_bytes(
        f"raw-frames/{camera.camera_code}/{date_prefix}/{frame_id}{outcome.raw_extension}",
        outcome.raw_bytes,
        content_type=outcome.raw_content_type,
    )

    processed_key: str | None = None
    if outcome.qc_passed and outcome.processed_png_bytes is not None:
        processed_key = storage.put_bytes(
            f"processed-frames/{camera.camera_code}/{date_prefix}/{frame_id}_640x640.png",
            outcome.processed_png_bytes,
            content_type="image/png",
        )

    record = ThermalFrame(
        id=frame_id,
        camera_id=camera.id,
        camera_code_snapshot=camera.camera_code,
        camera_name_snapshot=camera.name,
        zone_name_snapshot=camera.zone_name,
        capture_mode=capture_mode,
        source_filename=source_filename,
        captured_at=outcome.captured_at,
        frame_index=outcome.frame_index,
        width=outcome.width,
        height=outcome.height,
        pixel_format=outcome.pixel_format,
        qc_passed=outcome.qc_passed,
        qc_metrics=outcome.qc_metrics,
        rejection_reason=outcome.rejection_reason,
        raw_object_key=raw_key,
        processed_object_key=processed_key,
        processing_status="preprocessed" if outcome.qc_passed else "qc_failed",
        is_dev_test=is_dev_test,
    )
    db.add(record)
    return record


def _ensure_dev_sample_camera(db: Session) -> Camera:
    existing = db.execute(
        select(Camera).where(Camera.camera_code == DEV_CAMERA_CODE)
    ).scalar_one_or_none()
    if existing:
        return existing

    cam = Camera(
        camera_code=DEV_CAMERA_CODE,
        name="Development Thermal Test Bench",
        village_id=None,
        zone_name="Development Test Zone",
        zone_type="crop_field",
        latitude=11.664,
        longitude=76.622,
        geom=make_point_geom(11.664, 76.622, is_postgres_backend(db)),
        protocol="file_upload",
        stream_metadata={"mode": "DEVELOPMENT_TEST_MODE"},
        status="active",
        api_key_hash=hash_camera_api_key(generate_camera_api_key()),
        is_dev_test=True,
    )
    db.add(cam)
    db.commit()
    db.refresh(cam)
    return cam


async def _read_upload_bounded(upload: UploadFile, max_bytes: int, label: str) -> bytes:
    chunks: list[bytes] = []
    total = 0
    chunk_size = 1024 * 1024
    while True:
        chunk = await upload.read(chunk_size)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail=f"{label} exceeds maximum allowed size ({max_bytes // (1024 * 1024)} MB).",
            )
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/frames", response_model=ThermalFrameResponse, status_code=status.HTTP_201_CREATED)
async def ingest_camera_frame(
    file: UploadFile = File(...),
    metadata: str = Form(...),
    x_camera_key: str | None = Header(default=None, alias="X-Camera-Key"),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    storage: ObjectStorageBackend = Depends(get_storage_backend),
) -> ThermalFrameResponse:
    if not x_camera_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-Camera-Key authentication header.",
        )

    try:
        raw_meta = json.loads(metadata)
        contract = HttpFrameIngestionMetadata.model_validate(raw_meta)
    except (json.JSONDecodeError, ValidationError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid ingestion metadata contract: {exc}",
        ) from exc

    camera = db.execute(
        select(Camera).where(Camera.camera_code == contract.camera_id)
    ).scalar_one_or_none()
    if not camera:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Camera '{contract.camera_id}' is not registered.",
        )

    if not verify_camera_api_key(x_camera_key, camera.api_key_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid X-Camera-Key credentials for camera.",
        )

    filename = Path(file.filename or "frame.png").name
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported image format '{ext or 'none'}'. Allowed: {sorted(SUPPORTED_IMAGE_EXTENSIONS)}.",
        )

    raw_bytes = await _read_upload_bounded(
        file, settings.max_image_upload_mb * 1024 * 1024, "Thermal frame"
    )
    if not raw_bytes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Uploaded thermal frame is empty.",
        )

    outcome = process_image_bytes(
        raw_bytes,
        filename=filename,
        captured_at=contract.timestamp,
        frame_index=contract.sequence_number,
    )
    record = _persist_frame_outcome(
        db,
        storage,
        camera,
        outcome,
        capture_mode="http_push",
        source_filename=filename,
        is_dev_test=camera.is_dev_test,
    )
    camera.last_heartbeat_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(record)
    logger.info(
        "Ingested HTTP frame camera_code=%s frame_id=%s qc_passed=%s",
        camera.camera_code,
        record.id,
        record.qc_passed,
    )
    return _frame_to_response(record, camera)


@router.post(
    "/dev-sample",
    response_model=DevSampleIngestResponse,
    status_code=status.HTTP_201_CREATED,
)
async def ingest_dev_sample(
    file: UploadFile = File(...),
    camera_id: uuid.UUID | None = Form(default=None),
    target_fps: float = Form(default=5.0),
    captured_at: datetime | None = Form(default=None),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    storage: ObjectStorageBackend = Depends(get_storage_backend),
) -> DevSampleIngestResponse:
    if camera_id is not None:
        camera = db.get(Camera, camera_id)
        if not camera:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Referenced camera_id does not exist.",
            )
    else:
        camera = _ensure_dev_sample_camera(db)

    filename = Path(file.filename or "sample.png").name
    ext = Path(filename).suffix.lower()

    if ext in SUPPORTED_IMAGE_EXTENSIONS:
        raw_bytes = await _read_upload_bounded(
            file, settings.max_image_upload_mb * 1024 * 1024, "Sample thermal image"
        )
        if not raw_bytes:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Uploaded thermal image is empty.",
            )
        try:
            outcome = process_image_bytes(
                raw_bytes,
                filename=filename,
                captured_at=captured_at or datetime.now(timezone.utc),
                frame_index=0,
            )
        except UnsupportedMediaError as exc:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=str(exc),
            ) from exc

        record = _persist_frame_outcome(
            db,
            storage,
            camera,
            outcome,
            capture_mode="dev_sample_upload",
            source_filename=filename,
            is_dev_test=True,
        )
        db.commit()
        db.refresh(record)
        resp_frames = [_frame_to_response(record, camera)]
        return DevSampleIngestResponse(
            camera_id=camera.id,
            camera_code=camera.camera_code,
            storage_backend=storage.backend_name,
            media_type="image",
            extracted_count=1,
            accepted_count=1 if record.qc_passed else 0,
            rejected_count=0 if record.qc_passed else 1,
            frames=resp_frames,
        )

    if ext in SUPPORTED_VIDEO_EXTENSIONS:
        if target_fps <= 0 or target_fps > 30:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="target_fps must be between 0.1 and 30.",
            )
        video_bytes = await _read_upload_bounded(
            file, settings.max_video_upload_mb * 1024 * 1024, "Sample thermal video"
        )
        if not video_bytes:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Uploaded thermal video is empty.",
            )
        try:
            outcomes, summary = process_video_bytes(
                video_bytes,
                filename=filename,
                target_fps=target_fps,
                max_duration_seconds=settings.max_video_duration_seconds,
                max_frames=settings.max_video_frames,
                start_captured_at=captured_at or datetime.now(timezone.utc),
            )
        except MediaLimitError as exc:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail=str(exc),
            ) from exc
        except UnsupportedMediaError as exc:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=str(exc),
            ) from exc
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from exc

        records: list[ThermalFrame] = []
        for outcome in outcomes:
            rec = _persist_frame_outcome(
                db,
                storage,
                camera,
                outcome,
                capture_mode="dev_sample_upload",
                source_filename=filename,
                is_dev_test=True,
            )
            records.append(rec)
        db.commit()
        for rec in records:
            db.refresh(rec)

        accepted = sum(1 for r in records if r.qc_passed)
        return DevSampleIngestResponse(
            camera_id=camera.id,
            camera_code=camera.camera_code,
            storage_backend=storage.backend_name,
            media_type="video",
            extracted_count=len(records),
            accepted_count=accepted,
            rejected_count=len(records) - accepted,
            video_summary=summary,
            frames=[_frame_to_response(r, camera) for r in records],
        )

    raise HTTPException(
        status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        detail=(
            f"Unsupported file format '{ext or 'none'}'. Allowed images: "
            f"{sorted(SUPPORTED_IMAGE_EXTENSIONS)}, videos: {sorted(SUPPORTED_VIDEO_EXTENSIONS)}."
        ),
    )


@router.get("/frames", response_model=PaginatedResponse[ThermalFrameResponse])
def list_ingested_frames(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    camera_id: uuid.UUID | None = Query(default=None),
    qc_passed: bool | None = Query(default=None),
    processing_status: str | None = Query(default=None),
    capture_mode: str | None = Query(default=None),
    is_dev_test: bool | None = Query(default=None),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    date_range: str | None = Query(default=None),
    search: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> PaginatedResponse[ThermalFrameResponse]:
    stmt = select(ThermalFrame)
    if camera_id is not None:
        stmt = stmt.where(ThermalFrame.camera_id == camera_id)
    if qc_passed is not None:
        stmt = stmt.where(ThermalFrame.qc_passed == qc_passed)
    if processing_status and processing_status != "All":
        stmt = stmt.where(ThermalFrame.processing_status == processing_status)
    if capture_mode and capture_mode != "All":
        stmt = stmt.where(ThermalFrame.capture_mode == capture_mode)
    if is_dev_test is not None:
        stmt = stmt.where(ThermalFrame.is_dev_test == is_dev_test)
    if search and search.strip():
        q = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                ThermalFrame.source_filename.ilike(q),
                ThermalFrame.rejection_reason.ilike(q),
                ThermalFrame.pixel_format.ilike(q),
            )
        )

    stmt = apply_date_window(stmt, ThermalFrame.captured_at, date_from, date_to, date_range)
    stmt = stmt.order_by(ThermalFrame.captured_at.desc(), ThermalFrame.frame_index.asc())

    items, total, current_page, current_size, total_pages = paginate_select(
        db, stmt, page, page_size
    )

    cam_ids = {item.camera_id for item in items if item.camera_id is not None}
    cameras_by_id: dict[uuid.UUID, Camera] = {}
    if cam_ids:
        cams = db.execute(select(Camera).where(Camera.id.in_(cam_ids))).scalars().all()
        cameras_by_id = {c.id: c for c in cams}

    return PaginatedResponse[ThermalFrameResponse](
        items=[
            _frame_to_response(
                item,
                cameras_by_id.get(item.camera_id) if item.camera_id is not None else None,
            )
            for item in items
        ],
        total=total,
        page=current_page,
        page_size=current_size,
        total_pages=total_pages,
    )


def _render_raw_browser_preview(raw_bytes: bytes) -> bytes:
    """Renders 16-bit or TIFF raw image into un-enhanced 8-bit PNG strictly for browser display."""
    arr = np.frombuffer(raw_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
    if img is None:
        with Image.open(io.BytesIO(raw_bytes)) as pil_img:
            pil_img.load()
            img = np.array(pil_img)

    if img is None or img.size == 0:
        raise ValueError("Unable to render raw frame preview.")

    if img.dtype != np.uint8:
        lo = float(np.min(img))
        hi = float(np.max(img))
        if hi - lo > 1e-6:
            scaled = ((img.astype(np.float32) - lo) / (hi - lo)) * 255.0
            img_u8 = np.clip(scaled, 0, 255).astype(np.uint8)
        else:
            img_u8 = np.zeros(img.shape, dtype=np.uint8)
    else:
        img_u8 = img

    ok, encoded = cv2.imencode(".png", img_u8)
    if not ok:
        raise ValueError("Failed to encode browser preview PNG.")
    return encoded.tobytes()


@router.get("/frames/{frame_id}/image")
def get_frame_image(
    frame_id: uuid.UUID,
    variant: Literal["raw", "processed"] = Query(default="processed"),
    preview: bool = Query(default=False),
    db: Session = Depends(get_db),
    storage: ObjectStorageBackend = Depends(get_storage_backend),
) -> Response:
    frame = db.get(ThermalFrame, frame_id)
    if not frame:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thermal frame not found.")

    if variant == "processed":
        if not frame.processed_object_key:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Processed frame is unavailable because this frame failed quality validation.",
            )
        key = frame.processed_object_key
        media_type = "image/png"
    else:
        key = frame.raw_object_key
        ext = Path(key).suffix.lower()
        media_type = (
            "image/tiff"
            if ext in {".tif", ".tiff"}
            else "image/jpeg"
            if ext in {".jpg", ".jpeg"}
            else "image/png"
        )

    try:
        data = storage.get_bytes(key)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stored thermal frame artifact could not be located.",
        ) from exc

    if variant == "raw" and preview and (media_type == "image/tiff" or frame.pixel_format == "uint16_radiometric"):
        try:
            data = _render_raw_browser_preview(data)
            media_type = "image/png"
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Corrupted raw image cannot be previewed.",
            ) from exc

    return Response(
        content=data,
        media_type=media_type,
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.post("/rtsp/test-pull", response_model=RtspTestPullResponse)
def rtsp_test_pull(
    payload: RtspTestPullRequest,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    storage: ObjectStorageBackend = Depends(get_storage_backend),
) -> RtspTestPullResponse:
    masked_url = mask_url_credentials(payload.rtsp_url)
    camera: Camera | None = None
    if payload.camera_id is not None:
        camera = db.get(Camera, payload.camera_id)
        if not camera:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Referenced camera_id does not exist.",
            )

    try:
        outcomes = test_pull_rtsp_stream(
            payload.rtsp_url,
            max_frames=min(payload.max_frames, settings.rtsp_test_max_frames * 2),
            timeout_seconds=min(payload.timeout_seconds, settings.rtsp_test_timeout_seconds * 2.5),
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except RtspConnectionError as exc:
        logger.warning("RTSP test-pull failed for %s: %s", masked_url, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"RTSP stream test failed ({masked_url}): {exc}",
        ) from exc

    target_camera = camera or _ensure_dev_sample_camera(db)
    records: list[ThermalFrame] = []
    for outcome in outcomes:
        rec = _persist_frame_outcome(
            db,
            storage,
            target_camera,
            outcome,
            capture_mode="rtsp_test_pull",
            source_filename=masked_url[:250],
            is_dev_test=True,
        )
        records.append(rec)
    db.commit()
    for rec in records:
        db.refresh(rec)

    accepted = sum(1 for r in records if r.qc_passed)
    return RtspTestPullResponse(
        reachable=True,
        masked_rtsp_url=masked_url,
        frames_retrieved=len(records),
        accepted_count=accepted,
        rejected_count=len(records) - accepted,
        frames=[_frame_to_response(r, target_camera) for r in records],
    )
