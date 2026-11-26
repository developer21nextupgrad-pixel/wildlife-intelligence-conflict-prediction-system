from datetime import datetime, timezone
import logging
from pathlib import Path
import uuid

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
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.security import AuthenticatedPrincipal, require_roles
from app.models import Alert, AnimalDetection, AnimalEmbedding, ReidMatch, Sighting
from app.schemas.detection import (
    AnimalDetectionClearResponse,
    AnimalDetectionDeleteResponse,
    AnimalDetectionListResponse,
    AnimalDetectionModelMetadata,
    AnimalDetectionResponse,
    DetectionItemResponse,
    LinkedAlertSummary,
)
from app.services.animal_detection import (
    THERMAL_IMAGERY_NOTICE,
    AnimalDetectionPipeline,
    CorruptedAnimalImageError,
    UnsupportedAnimalImageError,
    get_animal_detection_pipeline,
    validate_animal_image_bytes,
)
from app.services.filters import paginate_select
from app.services.megadescriptor import (
    MEGADESCRIPTOR_LICENSE,
    MegaDescriptorExtractor,
    get_megadescriptor_extractor,
)
from app.services.reid_service import run_reid_for_detection
from app.services.storage import ObjectStorageBackend, get_storage_backend
from app.services.wildlife_intelligence import (
    evaluate_alert_rules_for_detection,
    link_detection_to_sighting,
    resolve_detection_context,
)

logger = logging.getLogger("wicps.detections")

router = APIRouter(prefix="/detections", tags=["Animal Detection & Species ID"])


def _get_pipeline_dep(
    settings: Settings = Depends(get_settings),
) -> AnimalDetectionPipeline:
    return get_animal_detection_pipeline(settings)


def _get_extractor_dep(
    settings: Settings = Depends(get_settings),
) -> MegaDescriptorExtractor:
    return get_megadescriptor_extractor(settings)


def _parse_optional_uuid(raw: str | None, field_name: str) -> uuid.UUID | None:
    if raw is None or not raw.strip():
        return None
    try:
        return uuid.UUID(raw.strip())
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid UUID for '{field_name}': {raw}",
        ) from exc


def _resolve_sighting_status(record: AnimalDetection, explicit: str | None = None) -> str:
    if explicit:
        return explicit
    if record.generated_sighting_id is not None:
        return "linked"
    if record.animal_count <= 0:
        return "no_animal_detected"
    if record.latitude is None or record.longitude is None:
        return "location_required_for_sighting"
    if record.processing_status == "needs_review":
        return "species_needs_review"
    return "not_linked"


def _can_delete_detection(
    record: AnimalDetection, principal: AuthenticatedPrincipal | None
) -> bool:
    if principal is None:
        return False
    effective = principal.effective_roles
    if "admin" in effective or "reviewer" in effective:
        return True
    return principal.user_id is not None and record.uploaded_by_user_id == principal.user_id


def _find_evidence_reference_reason(db: Session, record: AnimalDetection) -> str | None:
    """Checks whether a detection's image/crops are still referenced by sightings, alerts, or Re-ID records."""
    if record.generated_sighting_id is not None:
        return "linked_sighting"
    has_sighting = (
        db.execute(
            select(Sighting.id)
            .where(Sighting.animal_detection_id == record.id)
            .limit(1)
        ).scalar_one_or_none()
        is not None
    )
    if has_sighting:
        return "linked_sighting"

    if record.generated_alert_ids:
        return "linked_alert"
    has_alert = (
        db.execute(
            select(Alert.id)
            .where(Alert.animal_detection_id == record.id)
            .limit(1)
        ).scalar_one_or_none()
        is not None
    )
    if has_alert:
        return "linked_alert"

    has_embedding = (
        db.execute(
            select(AnimalEmbedding.id)
            .where(AnimalEmbedding.detection_id == record.id)
            .limit(1)
        ).scalar_one_or_none()
        is not None
    )
    if has_embedding:
        return "linked_reid_embedding"

    has_reid_match = (
        db.execute(
            select(ReidMatch.id)
            .where(ReidMatch.detection_id == record.id)
            .limit(1)
        ).scalar_one_or_none()
        is not None
    )
    if has_reid_match:
        return "linked_reid_match"

    return None


def _build_detection_filter_stmt(
    *,
    processing_status: str | None = None,
    search: str | None = None,
    include_deleted: bool = False,
):
    stmt = select(AnimalDetection)
    if not include_deleted:
        stmt = stmt.where(AnimalDetection.is_deleted.is_(False))
    if processing_status and processing_status != "All":
        stmt = stmt.where(AnimalDetection.processing_status == processing_status)
    if search and search.strip():
        q = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                AnimalDetection.source_filename.ilike(q),
                AnimalDetection.primary_species.ilike(q),
                AnimalDetection.primary_common_name.ilike(q),
                AnimalDetection.primary_scientific_name.ilike(q),
                AnimalDetection.location_name.ilike(q),
            )
        )
    return stmt


def _record_to_response(
    record: AnimalDetection,
    settings: Settings,
    storage_backend_name: str,
    db: Session | None = None,
    sighting_status_override: str | None = None,
    linked_alerts_override: list[Alert] | None = None,
    principal: AuthenticatedPrincipal | None = None,
) -> AnimalDetectionResponse:
    items = [DetectionItemResponse.model_validate(item) for item in (record.detections or [])]
    image_url = f"{settings.api_v1_prefix.rstrip('/')}/detections/{record.id}/image"

    alerts_list: list[Alert] = []
    if linked_alerts_override is not None:
        alerts_list = linked_alerts_override
    elif db is not None and (record.generated_alert_ids or []):
        alerts_list = list(
            db.execute(
                select(Alert)
                .where(Alert.animal_detection_id == record.id)
                .order_by(Alert.triggered_at.desc())
            )
            .scalars()
            .all()
        )

    alert_summaries = [
        LinkedAlertSummary(
            id=a.id,
            title=a.title,
            severity=a.severity,
            affected_village=a.affected_village,
            assigned_officer=a.assigned_officer,
            response_status=a.response_status,
            risk_reason=a.risk_reason,
        )
        for a in alerts_list
    ]

    return AnimalDetectionResponse(
        id=record.id,
        source_filename=record.source_filename,
        content_type=record.content_type,
        file_size_bytes=record.file_size_bytes,
        width=record.width,
        height=record.height,
        image_object_key=record.image_object_key,
        image_url=image_url,
        storage_backend=storage_backend_name,
        processing_status=record.processing_status,  # type: ignore[arg-type]
        detection_count=record.detection_count,
        animal_count=record.animal_count,
        primary_species=record.primary_species,
        primary_common_name=record.primary_common_name,
        primary_scientific_name=record.primary_scientific_name,
        primary_confidence=record.primary_confidence,
        country_code=record.country_code,
        admin1_region=record.admin1_region,
        camera_id=record.camera_id,
        village_id=record.village_id,
        captured_at=record.captured_at,
        latitude=record.latitude,
        longitude=record.longitude,
        location_name=record.location_name,
        idempotency_key=record.idempotency_key,
        generated_sighting_id=record.generated_sighting_id,
        sighting_integration_status=_resolve_sighting_status(record, sighting_status_override),
        generated_alert_ids=list(record.generated_alert_ids or []),
        generated_alerts=alert_summaries,
        detector_model=record.detector_model,
        classifier_model=record.classifier_model,
        inference_duration_ms=record.inference_duration_ms,
        detections=items,
        model_metadata=AnimalDetectionModelMetadata(
            detector_model=record.detector_model,
            classifier_model=record.classifier_model,
            speciesnet_version="4.0.3a",
            geofence_enabled=settings.speciesnet_geofence_enabled,
            country_code=record.country_code,
            admin1_region=record.admin1_region,
            min_detection_confidence=settings.speciesnet_min_detection_confidence,
            min_species_confidence=settings.speciesnet_min_species_confidence,
            thermal_imagery_supported=False,
            imagery_notice=THERMAL_IMAGERY_NOTICE,
            reid_enabled=settings.megadescriptor_enabled,
            reid_model=settings.megadescriptor_model if settings.megadescriptor_enabled else None,
            reid_license=MEGADESCRIPTOR_LICENSE if settings.megadescriptor_enabled else None,
            reid_match_threshold=settings.reid_match_threshold if settings.megadescriptor_enabled else None,
            reid_ambiguous_threshold=(
                settings.reid_ambiguous_threshold if settings.megadescriptor_enabled else None
            ),
        ),
        error_message=record.error_message,
        uploaded_by_user_id=record.uploaded_by_user_id,
        can_delete=_can_delete_detection(record, principal),
        is_deleted=record.is_deleted,
        deleted_at=record.deleted_at,
        deleted_by=record.deleted_by,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


async def _read_upload_bounded(upload: UploadFile, max_bytes: int) -> bytes:
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
                detail=f"Image exceeds maximum allowed size ({max_bytes // (1024 * 1024)} MB).",
            )
        chunks.append(chunk)
    return b"".join(chunks)


@router.post(
    "/upload",
    response_model=AnimalDetectionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_and_detect_animal(
    response: Response,
    file: UploadFile = File(...),
    country_code: str | None = Form(default=None),
    admin1_region: str | None = Form(default=None),
    camera_id: str | None = Form(default=None),
    village_id: str | None = Form(default=None),
    latitude: float | None = Form(default=None),
    longitude: float | None = Form(default=None),
    location_name: str | None = Form(default=None),
    captured_at: datetime | None = Form(default=None),
    auto_create_sighting: bool = Form(default=True),
    idempotency_key: str | None = Form(default=None),
    idempotency_header: str | None = Header(default=None, alias="Idempotency-Key"),
    principal: AuthenticatedPrincipal = Depends(require_roles("operator")),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    storage: ObjectStorageBackend = Depends(get_storage_backend),
    pipeline: AnimalDetectionPipeline = Depends(_get_pipeline_dep),
    extractor: MegaDescriptorExtractor = Depends(_get_extractor_dep),
) -> AnimalDetectionResponse:
    eff_idem_raw = (idempotency_key or idempotency_header or "").strip()
    eff_idem_key = eff_idem_raw[:128] if eff_idem_raw else None
    if eff_idem_key:
        existing = db.execute(
            select(AnimalDetection).where(
                AnimalDetection.idempotency_key == eff_idem_key,
                AnimalDetection.is_deleted.is_(False),
            )
        ).scalar_one_or_none()
        if existing is not None:
            response.status_code = status.HTTP_200_OK
            return _record_to_response(
                existing, settings, storage.backend_name, db=db, principal=principal
            )

    if (latitude is None) != (longitude is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Both latitude and longitude must be provided together.",
        )
    if latitude is not None and not (-90.0 <= latitude <= 90.0):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="latitude must be between -90 and 90.",
        )
    if longitude is not None and not (-180.0 <= longitude <= 180.0):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="longitude must be between -180 and 180.",
        )

    parsed_camera_id = _parse_optional_uuid(camera_id, "camera_id")
    parsed_village_id = _parse_optional_uuid(village_id, "village_id")

    
    try:
        location_ctx = resolve_detection_context(
            db,
            camera_id=parsed_camera_id,
            village_id=parsed_village_id,
            latitude=latitude,
            longitude=longitude,
            location_name=location_name,
        )
    except ValueError as exc:
        msg = str(exc)
        err_status = (
            status.HTTP_404_NOT_FOUND
            if "does not exist" in msg
            else status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        raise HTTPException(status_code=err_status, detail=msg) from exc

    db.commit()

    observed_at = captured_at or datetime.now(timezone.utc)
    if observed_at.tzinfo is None:
        observed_at = observed_at.replace(tzinfo=timezone.utc)

    filename = Path(file.filename or "upload.jpg").name
    raw_bytes = await _read_upload_bounded(
        file, settings.max_image_upload_mb * 1024 * 1024
    )

    try:
        validated = validate_animal_image_bytes(raw_bytes, filename)
    except UnsupportedAnimalImageError as exc:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=str(exc),
        ) from exc
    except CorruptedAnimalImageError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    detection_id = uuid.uuid4()
    date_prefix = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    object_key = storage.put_bytes(
        f"animal-detections/{date_prefix}/{detection_id}{validated.extension}",
        raw_bytes,
        content_type=validated.content_type,
    )

    effective_country = (
        country_code.strip().upper()
        if country_code is not None and country_code.strip()
        else settings.speciesnet_default_country
    )
    effective_admin1 = (
        admin1_region.strip().upper()
        if admin1_region is not None and admin1_region.strip()
        else settings.speciesnet_default_admin1_region
    )

    try:
        analysis = pipeline.analyze_image(
            validated.pil_image,
            image_key=object_key,
            country_code=effective_country,
            admin1_region=effective_admin1,
        )
    except Exception as exc:
        try:
            storage.delete(object_key)
        except Exception:
            logger.warning("Cleanup delete failed for object_key=%s", object_key)
        logger.exception("SpeciesNet inference failed for %s", filename)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="SpeciesNet inference failed. Check server diagnostics for details.",
        ) from exc

    record = AnimalDetection(
        id=detection_id,
        source_filename=filename[:255],
        content_type=validated.content_type,
        file_size_bytes=validated.file_size_bytes,
        width=validated.width,
        height=validated.height,
        image_object_key=object_key,
        processing_status=analysis["processing_status"],
        detection_count=analysis["detection_count"],
        animal_count=analysis["animal_count"],
        primary_species=analysis["primary_species"],
        primary_common_name=analysis["primary_common_name"],
        primary_scientific_name=analysis["primary_scientific_name"],
        primary_confidence=analysis["primary_confidence"],
        country_code=analysis["country_code"],
        admin1_region=analysis["admin1_region"],
        camera_id=location_ctx.camera.id if location_ctx.camera else None,
        village_id=location_ctx.village.id if location_ctx.village else None,
        captured_at=observed_at,
        latitude=location_ctx.latitude,
        longitude=location_ctx.longitude,
        location_name=location_ctx.location_name,
        idempotency_key=eff_idem_key,
        generated_alert_ids=[],
        uploaded_by_user_id=principal.user_id,
        is_deleted=False,
        detector_model=analysis["detector_model"],
        classifier_model=analysis["classifier_model"],
        inference_duration_ms=analysis["inference_duration_ms"],
        detections=analysis["detections"],
        error_message=None,
    )
    db.add(record)
    db.flush()

    crop_keys_to_cleanup: list[str] = []
    sighting_status_val: str | None = None
    created_alerts: list[Alert] = []
    try:
        if settings.megadescriptor_enabled and record.detections:
            reid_items = run_reid_for_detection(
                db,
                detection=record,
                pil_image=validated.pil_image,
                storage=storage,
                extractor=extractor,
                settings=settings,
                observed_at=observed_at,
            )
            crop_keys_to_cleanup = [
                str(item["crop_object_key"])
                for item in reid_items
                if item.get("crop_object_key")
            ]

        linked_sighting = None
        if auto_create_sighting:
            linked_sighting, sighting_status_val = link_detection_to_sighting(
                db,
                detection=record,
                ctx=location_ctx,
                observed_at=observed_at,
                settings=settings,
            )
        else:
            sighting_status_val = "auto_sighting_disabled"

        created_alerts = evaluate_alert_rules_for_detection(
            db,
            detection=record,
            sighting=linked_sighting,
            ctx=location_ctx,
            observed_at=observed_at,
            settings=settings,
        )

        db.commit()
        db.refresh(record)
    except Exception:
        db.rollback()
        for key in [object_key, *crop_keys_to_cleanup]:
            try:
                storage.delete(key)
            except Exception:
                logger.warning("Failed to rollback object storage key=%s after DB failure", key)
        raise

    logger.info(
        "Detected animals id=%s file=%s status=%s animals=%d primary=%s sighting=%s alerts=%d duration_ms=%d",
        record.id,
        record.source_filename,
        record.processing_status,
        record.animal_count,
        record.primary_species,
        record.generated_sighting_id,
        len(created_alerts),
        record.inference_duration_ms,
    )
    return _record_to_response(
        record,
        settings,
        storage.backend_name,
        db=db,
        sighting_status_override=sighting_status_val,
        linked_alerts_override=created_alerts,
        principal=principal,
    )


@router.get(
    "",
    response_model=AnimalDetectionListResponse,
)
def list_animal_detections(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    processing_status: str | None = Query(default=None),
    search: str | None = Query(default=None),
    principal: AuthenticatedPrincipal = Depends(require_roles("operator")),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    storage: ObjectStorageBackend = Depends(get_storage_backend),
) -> AnimalDetectionListResponse:
    stmt = _build_detection_filter_stmt(
        processing_status=processing_status,
        search=search,
        include_deleted=False,
    )

    # Calculate eligible clear count for the caller under current filters
    effective = principal.effective_roles
    if "admin" in effective or "reviewer" in effective:
        eligible_stmt = select(func.count()).select_from(stmt.subquery())
        eligible_clear_count = int(db.execute(eligible_stmt).scalar_one() or 0)
    elif principal.user_id is not None:
        own_stmt = stmt.where(AnimalDetection.uploaded_by_user_id == principal.user_id)
        eligible_clear_count = int(
            db.execute(select(func.count()).select_from(own_stmt.subquery())).scalar_one() or 0
        )
    else:
        eligible_clear_count = 0

    stmt = stmt.order_by(AnimalDetection.created_at.desc())
    items, total, current_page, current_size, total_pages = paginate_select(
        db, stmt, page, page_size
    )
    return AnimalDetectionListResponse(
        items=[
            _record_to_response(
                item,
                settings,
                storage.backend_name,
                db=db,
                principal=principal,
            )
            for item in items
        ],
        total=total,
        page=current_page,
        page_size=current_size,
        total_pages=total_pages,
        eligible_clear_count=eligible_clear_count,
    )


@router.delete(
    "",
    response_model=AnimalDetectionClearResponse,
)
def clear_animal_detection_history(
    processing_status: str | None = Query(default=None),
    search: str | None = Query(default=None),
    reason: str | None = Query(default=None, max_length=255),
    principal: AuthenticatedPrincipal = Depends(require_roles("operator")),
    db: Session = Depends(get_db),
    storage: ObjectStorageBackend = Depends(get_storage_backend),
) -> AnimalDetectionClearResponse:
    """Soft-deletes all eligible active detection history records for the authenticated caller.

    Preserves linked sightings, alerts, incidents, animal identities, Re-ID embeddings, and crops.
    Unreferenced source image objects are cleaned from storage only after the DB transaction commits.
    """
    base_stmt = _build_detection_filter_stmt(
        processing_status=processing_status,
        search=search,
        include_deleted=False,
    )
    all_visible = list(db.execute(base_stmt).scalars().all())
    eligible = [rec for rec in all_visible if _can_delete_detection(rec, principal)]
    skipped = len(all_visible) - len(eligible)

    if not eligible:
        return AnimalDetectionClearResponse(
            status="cleared",
            cleared_count=0,
            skipped_unauthorized_count=skipped,
            storage_objects_cleaned=0,
            storage_objects_preserved=0,
        )

    now = datetime.now(timezone.utc)
    clean_reason = (reason or "Cleared from detection history").strip()[:255]
    unreferenced_keys: list[str] = []
    preserved_count = 0

    try:
        for record in eligible:
            ref_reason = _find_evidence_reference_reason(db, record)
            if ref_reason is None and record.image_object_key:
                unreferenced_keys.append(record.image_object_key)
            else:
                preserved_count += 1

            record.is_deleted = True
            record.deleted_at = now
            record.deleted_by = principal.audit_label
            record.deletion_reason = clean_reason
            # Release idempotency_key only if not needed, keeping record intact for audit
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to clear animal detection history for actor=%s", principal.audit_label)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to clear detection history. Database changes were rolled back.",
        )

    cleaned_count = 0
    for key in unreferenced_keys:
        try:
            storage.delete(key)
            cleaned_count += 1
        except Exception:
            logger.warning("Post-commit storage cleanup failed for unreferenced key=%s", key)

    logger.info(
        "Cleared animal detection history actor=%s cleared=%d skipped=%d storage_cleaned=%d storage_preserved=%d",
        principal.audit_label,
        len(eligible),
        skipped,
        cleaned_count,
        preserved_count,
    )
    return AnimalDetectionClearResponse(
        status="cleared",
        cleared_count=len(eligible),
        skipped_unauthorized_count=skipped,
        storage_objects_cleaned=cleaned_count,
        storage_objects_preserved=preserved_count,
    )


@router.get(
    "/{detection_id}",
    response_model=AnimalDetectionResponse,
)
def get_animal_detection(
    detection_id: uuid.UUID,
    include_deleted: bool = Query(default=False),
    principal: AuthenticatedPrincipal = Depends(require_roles("operator")),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    storage: ObjectStorageBackend = Depends(get_storage_backend),
) -> AnimalDetectionResponse:
    record = db.get(AnimalDetection, detection_id)
    allow_archived = include_deleted and ("admin" in principal.effective_roles)
    if not record or (record.is_deleted and not allow_archived):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Animal detection record not found.",
        )
    return _record_to_response(
        record, settings, storage.backend_name, db=db, principal=principal
    )


@router.delete(
    "/{detection_id}",
    response_model=AnimalDetectionDeleteResponse,
)
def delete_animal_detection(
    detection_id: uuid.UUID,
    reason: str | None = Query(default=None, max_length=255),
    principal: AuthenticatedPrincipal = Depends(require_roles("operator")),
    db: Session = Depends(get_db),
    storage: ObjectStorageBackend = Depends(get_storage_backend),
) -> AnimalDetectionDeleteResponse:
    """Soft-deletes/archives a single detection record with RBAC and evidence preservation."""
    record = db.get(AnimalDetection, detection_id)
    if not record or record.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Animal detection record not found.",
        )

    if not _can_delete_detection(record, principal):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions. Only the uploader, a reviewer, or an administrator can delete this detection record.",
        )

    now = datetime.now(timezone.utc)
    clean_reason = (reason or "Removed from detection history").strip()[:255]
    ref_reason = _find_evidence_reference_reason(db, record)
    key_to_clean = record.image_object_key if ref_reason is None else None

    try:
        record.is_deleted = True
        record.deleted_at = now
        record.deleted_by = principal.audit_label
        record.deletion_reason = clean_reason
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to archive animal detection id=%s", detection_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete detection record. Database changes were rolled back.",
        )

    storage_cleaned = False
    if key_to_clean:
        try:
            storage.delete(key_to_clean)
            storage_cleaned = True
        except Exception:
            logger.warning(
                "Post-commit storage cleanup failed for unreferenced detection id=%s key=%s",
                detection_id,
                key_to_clean,
            )

    logger.info(
        "Archived animal detection id=%s actor=%s storage_cleaned=%s preserved_reason=%s",
        detection_id,
        principal.audit_label,
        storage_cleaned,
        ref_reason,
    )
    return AnimalDetectionDeleteResponse(
        status="archived",
        id=record.id,
        source_filename=record.source_filename,
        deleted_at=now,
        deleted_by=principal.audit_label,
        storage_cleaned=storage_cleaned,
        storage_preserved_reason=ref_reason,
    )


@router.get("/{detection_id}/image", dependencies=[Depends(require_roles("operator"))])
def get_animal_detection_image(
    detection_id: uuid.UUID,
    db: Session = Depends(get_db),
    storage: ObjectStorageBackend = Depends(get_storage_backend),
) -> Response:
    record = db.get(AnimalDetection, detection_id)
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Animal detection record not found.",
        )

    try:
        data = storage.get_bytes(record.image_object_key)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stored animal detection image could not be located.",
        ) from exc

    return Response(
        content=data,
        media_type=record.content_type or "image/jpeg",
        headers={"Cache-Control": "private, max-age=300"},
    )
