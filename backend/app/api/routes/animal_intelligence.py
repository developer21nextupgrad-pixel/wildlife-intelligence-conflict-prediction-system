from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.security import AuthenticatedPrincipal, require_roles
from app.models import (
    AlertDeliveryAttempt,
    AlertRule,
    AnimalDetection,
    AnimalEmbedding,
    AnimalIdentity,
    ForestOfficer,
    IdentityReviewLog,
    ReidMatch,
    Sighting,
)
from app.schemas.animal_intelligence import (
    AlertDeliveryAttemptResponse,
    AlertRuleCreate,
    AlertRuleResponse,
    AlertRuleUpdate,
    AnimalEmbeddingImageResponse,
    AnimalIdentityDetailResponse,
    AnimalIdentitySummaryResponse,
    ForestOfficerResponse,
    IdentityReviewLogResponse,
    ReidMatchResponse,
    ReidReviewRequest,
)
from app.schemas.common import PaginatedResponse
from app.schemas.sighting import SightingResponse
from app.services.filters import paginate_select
from app.services.reid_service import apply_manual_review
from app.services.storage import ObjectStorageBackend, get_storage_backend

logger = logging.getLogger("wicps.animal_intelligence")

router = APIRouter(prefix="/animal-intelligence", tags=["Wildlife Re-ID & Intelligence"])


def _identity_to_summary(
    record: AnimalIdentity,
    api_prefix: str,
    primary_embedding_id: uuid.UUID | None = None,
) -> AnimalIdentitySummaryResponse:
    crop_url = (
        f"{api_prefix}/animal-intelligence/crops/{primary_embedding_id}/image"
        if primary_embedding_id
        else None
    )
    return AnimalIdentitySummaryResponse(
        id=record.id,
        animal_code=record.animal_code,
        species=record.species,
        scientific_name=record.scientific_name,
        species_prefix=record.species_prefix,
        status=record.status,
        verification_status=record.verification_status,
        primary_crop_url=crop_url,
        first_seen_at=record.first_seen_at,
        last_seen_at=record.last_seen_at,
        total_sightings=record.total_sightings,
        reference_image_count=record.reference_image_count,
        notes=record.notes,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _match_to_response(
    m: ReidMatch,
    *,
    api_prefix: str,
    code_by_id: dict[uuid.UUID, str],
) -> ReidMatchResponse:
    return ReidMatchResponse(
        id=m.id,
        detection_id=m.detection_id,
        embedding_id=m.embedding_id,
        detection_item_index=m.detection_item_index,
        species=m.species,
        matched_animal_id=m.matched_animal_id,
        matched_animal_code=code_by_id.get(m.matched_animal_id) if m.matched_animal_id else None,
        suggested_animal_id=m.suggested_animal_id,
        suggested_animal_code=code_by_id.get(m.suggested_animal_id) if m.suggested_animal_id else None,
        similarity_score=m.similarity_score,
        decision=m.decision,
        review_status=m.review_status,
        review_reason=m.review_reason,
        top_candidates=m.top_candidates or [],
        crop_image_url=f"{api_prefix}/animal-intelligence/crops/{m.embedding_id}/image",
        source_image_url=f"{api_prefix}/detections/{m.detection_id}/image",
        model_version=m.model_version,
        thresholds_snapshot=m.thresholds_snapshot or {},
        created_at=m.created_at,
        updated_at=m.updated_at,
    )


def _resolve_primary_embedding_map(
    db: Session, identity_ids: list[uuid.UUID]
) -> dict[uuid.UUID, uuid.UUID]:
    if not identity_ids:
        return {}
    rows = db.execute(
        select(AnimalEmbedding.animal_identity_id, AnimalEmbedding.id)
        .where(AnimalEmbedding.animal_identity_id.in_(identity_ids))
        .order_by(AnimalEmbedding.is_reference.desc(), AnimalEmbedding.created_at.desc())
    ).all()
    mapping: dict[uuid.UUID, uuid.UUID] = {}
    for ident_id, emb_id in rows:
        if ident_id and ident_id not in mapping:
            mapping[ident_id] = emb_id
    return mapping


def _resolve_animal_codes_for_matches(
    db: Session, matches: list[ReidMatch]
) -> dict[uuid.UUID, str]:
    ids: set[uuid.UUID] = set()
    for m in matches:
        if m.matched_animal_id:
            ids.add(m.matched_animal_id)
        if m.suggested_animal_id:
            ids.add(m.suggested_animal_id)
    if not ids:
        return {}
    rows = db.execute(
        select(AnimalIdentity.id, AnimalIdentity.animal_code).where(
            AnimalIdentity.id.in_(list(ids))
        )
    ).all()
    return {row[0]: row[1] for row in rows}


@router.get(
    "/animals",
    response_model=PaginatedResponse[AnimalIdentitySummaryResponse],
    dependencies=[Depends(require_roles("operator"))],
)
def list_animal_identities(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    species: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    verification_status: str | None = Query(default=None),
    search: str | None = Query(default=None),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> PaginatedResponse[AnimalIdentitySummaryResponse]:
    stmt = select(AnimalIdentity)
    if species and species != "All":
        stmt = stmt.where(AnimalIdentity.species.ilike(f"%{species.strip()}%"))
    if status_filter and status_filter != "All":
        stmt = stmt.where(AnimalIdentity.status == status_filter)
    if verification_status and verification_status != "All":
        stmt = stmt.where(AnimalIdentity.verification_status == verification_status)
    if search and search.strip():
        q = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                AnimalIdentity.animal_code.ilike(q),
                AnimalIdentity.species.ilike(q),
                AnimalIdentity.scientific_name.ilike(q),
                AnimalIdentity.notes.ilike(q),
            )
        )
    stmt = stmt.order_by(AnimalIdentity.last_seen_at.desc(), AnimalIdentity.created_at.desc())
    items, total, current_page, current_size, total_pages = paginate_select(
        db, stmt, page, page_size
    )
    api_prefix = settings.api_v1_prefix.rstrip("/")
    primary_map = _resolve_primary_embedding_map(db, [item.id for item in items])
    return PaginatedResponse[AnimalIdentitySummaryResponse](
        items=[
            _identity_to_summary(item, api_prefix, primary_map.get(item.id))
            for item in items
        ],
        total=total,
        page=current_page,
        page_size=current_size,
        total_pages=total_pages,
    )


@router.get(
    "/animals/{animal_id}",
    response_model=AnimalIdentityDetailResponse,
    dependencies=[Depends(require_roles("operator"))],
)
def get_animal_identity(
    animal_id: uuid.UUID,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> AnimalIdentityDetailResponse:
    identity = db.get(AnimalIdentity, animal_id)
    if not identity:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Animal identity not found.",
        )

    api_prefix = settings.api_v1_prefix.rstrip("/")
    embeddings = list(
        db.execute(
            select(AnimalEmbedding)
            .where(AnimalEmbedding.animal_identity_id == animal_id)
            .order_by(AnimalEmbedding.created_at.desc())
        )
        .scalars()
        .all()
    )
    matches = list(
        db.execute(
            select(ReidMatch)
            .where(
                or_(
                    ReidMatch.matched_animal_id == animal_id,
                    ReidMatch.suggested_animal_id == animal_id,
                )
            )
            .order_by(ReidMatch.created_at.desc())
        )
        .scalars()
        .all()
    )
    match_ids = [m.id for m in matches]
    logs_stmt = select(IdentityReviewLog).where(
        or_(
            IdentityReviewLog.animal_identity_id == animal_id,
            IdentityReviewLog.previous_animal_id == animal_id,
            IdentityReviewLog.match_id.in_(match_ids) if match_ids else False,
        )
    ).order_by(IdentityReviewLog.reviewed_at.desc())
    review_logs = list(db.execute(logs_stmt).scalars().all())

    primary_emb_id = embeddings[0].id if embeddings else None
    summary = _identity_to_summary(identity, api_prefix, primary_emb_id)
    code_by_id = _resolve_animal_codes_for_matches(db, matches)

    return AnimalIdentityDetailResponse(
        **summary.model_dump(),
        images=[
            AnimalEmbeddingImageResponse(
                id=emb.id,
                detection_id=emb.detection_id,
                detection_item_index=emb.detection_item_index,
                animal_identity_id=emb.animal_identity_id,
                crop_image_url=f"{api_prefix}/animal-intelligence/crops/{emb.id}/image",
                source_image_url=f"{api_prefix}/detections/{emb.detection_id}/image",
                species=emb.species,
                model_name=emb.model_name,
                model_version=emb.model_version,
                embedding_dim=emb.embedding_dim,
                crop_width=emb.crop_width,
                crop_height=emb.crop_height,
                blur_score=emb.blur_score,
                quality_passed=emb.quality_passed,
                is_reference=emb.is_reference,
                created_at=emb.created_at,
            )
            for emb in embeddings
        ],
        matches=[
            _match_to_response(m, api_prefix=api_prefix, code_by_id=code_by_id)
            for m in matches
        ],
        review_logs=[IdentityReviewLogResponse.model_validate(log) for log in review_logs],
    )


@router.get(
    "/animals/{animal_id}/sightings",
    response_model=PaginatedResponse[SightingResponse],
    dependencies=[Depends(require_roles("operator"))],
)
def get_animal_identity_sightings(
    animal_id: uuid.UUID,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
) -> PaginatedResponse[SightingResponse]:
    identity = db.get(AnimalIdentity, animal_id)
    if not identity:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Animal identity not found.",
        )
    stmt = (
        select(Sighting)
        .where(Sighting.animal_identity_id == animal_id)
        .order_by(Sighting.timestamp.desc(), Sighting.created_at.desc())
    )
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


@router.get(
    "/animals/{animal_id}/images",
    response_model=PaginatedResponse[AnimalEmbeddingImageResponse],
    dependencies=[Depends(require_roles("operator"))],
)
def get_animal_identity_images(
    animal_id: uuid.UUID,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> PaginatedResponse[AnimalEmbeddingImageResponse]:
    identity = db.get(AnimalIdentity, animal_id)
    if not identity:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Animal identity not found.",
        )
    stmt = (
        select(AnimalEmbedding)
        .where(AnimalEmbedding.animal_identity_id == animal_id)
        .order_by(AnimalEmbedding.created_at.desc())
    )
    items, total, current_page, current_size, total_pages = paginate_select(
        db, stmt, page, page_size
    )
    api_prefix = settings.api_v1_prefix.rstrip("/")
    return PaginatedResponse[AnimalEmbeddingImageResponse](
        items=[
            AnimalEmbeddingImageResponse(
                id=emb.id,
                detection_id=emb.detection_id,
                detection_item_index=emb.detection_item_index,
                animal_identity_id=emb.animal_identity_id,
                crop_image_url=f"{api_prefix}/animal-intelligence/crops/{emb.id}/image",
                source_image_url=f"{api_prefix}/detections/{emb.detection_id}/image",
                species=emb.species,
                model_name=emb.model_name,
                model_version=emb.model_version,
                embedding_dim=emb.embedding_dim,
                crop_width=emb.crop_width,
                crop_height=emb.crop_height,
                blur_score=emb.blur_score,
                quality_passed=emb.quality_passed,
                is_reference=emb.is_reference,
                created_at=emb.created_at,
            )
            for emb in items
        ],
        total=total,
        page=current_page,
        page_size=current_size,
        total_pages=total_pages,
    )


@router.get(
    "/matches",
    response_model=PaginatedResponse[ReidMatchResponse],
    dependencies=[Depends(require_roles("operator"))],
)
def list_reid_matches(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    decision: str | None = Query(default=None),
    review_status: str | None = Query(default=None),
    species: str | None = Query(default=None),
    animal_identity_id: uuid.UUID | None = Query(default=None),
    needs_review_only: bool = Query(default=False),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> PaginatedResponse[ReidMatchResponse]:
    stmt = select(ReidMatch)
    if decision and decision != "All":
        stmt = stmt.where(ReidMatch.decision == decision)
    if review_status and review_status != "All":
        stmt = stmt.where(ReidMatch.review_status == review_status)
    if needs_review_only:
        stmt = stmt.where(
            or_(
                ReidMatch.decision == "needs_review",
                ReidMatch.review_status == "pending_review",
            )
        )
    if species and species != "All":
        stmt = stmt.where(ReidMatch.species.ilike(f"%{species.strip()}%"))
    if animal_identity_id is not None:
        stmt = stmt.where(
            or_(
                ReidMatch.matched_animal_id == animal_identity_id,
                ReidMatch.suggested_animal_id == animal_identity_id,
            )
        )
    stmt = stmt.order_by(ReidMatch.created_at.desc())
    items, total, current_page, current_size, total_pages = paginate_select(
        db, stmt, page, page_size
    )
    api_prefix = settings.api_v1_prefix.rstrip("/")
    code_by_id = _resolve_animal_codes_for_matches(db, items)
    return PaginatedResponse[ReidMatchResponse](
        items=[
            _match_to_response(m, api_prefix=api_prefix, code_by_id=code_by_id)
            for m in items
        ],
        total=total,
        page=current_page,
        page_size=current_size,
        total_pages=total_pages,
    )


@router.post("/matches/{match_id}/review", response_model=ReidMatchResponse)
def review_reid_match(
    match_id: uuid.UUID,
    payload: ReidReviewRequest,
    principal: AuthenticatedPrincipal = Depends(require_roles("reviewer")),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> ReidMatchResponse:
    match = db.get(ReidMatch, match_id)
    if not match:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Re-ID match record not found.",
        )

    try:
        updated = apply_manual_review(
            db,
            match=match,
            action=payload.action,
            reviewed_by=principal.audit_label,
            reason=payload.reason,
            target_animal_identity_id=payload.target_animal_identity_id,
            create_new_identity=payload.create_new_identity,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    db.commit()
    db.refresh(updated)
    api_prefix = settings.api_v1_prefix.rstrip("/")
    code_by_id = _resolve_animal_codes_for_matches(db, [updated])
    return _match_to_response(updated, api_prefix=api_prefix, code_by_id=code_by_id)


@router.get("/crops/{embedding_id}/image", dependencies=[Depends(require_roles("operator"))])
def get_animal_crop_image(
    embedding_id: uuid.UUID,
    db: Session = Depends(get_db),
    storage: ObjectStorageBackend = Depends(get_storage_backend),
) -> Response:
    emb = db.get(AnimalEmbedding, embedding_id)
    if not emb:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Animal crop embedding record not found.",
        )
    try:
        data = storage.get_bytes(emb.crop_object_key)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stored animal crop JPEG could not be located.",
        ) from exc

    return Response(
        content=data,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.get(
    "/alert-rules",
    response_model=PaginatedResponse[AlertRuleResponse],
    dependencies=[Depends(require_roles("operator"))],
)
def list_alert_rules(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    enabled: bool | None = Query(default=None),
    db: Session = Depends(get_db),
) -> PaginatedResponse[AlertRuleResponse]:
    stmt = select(AlertRule)
    if enabled is not None:
        stmt = stmt.where(AlertRule.enabled.is_(enabled))
    stmt = stmt.order_by(AlertRule.created_at.desc())
    items, total, current_page, current_size, total_pages = paginate_select(
        db, stmt, page, page_size
    )
    return PaginatedResponse[AlertRuleResponse](
        items=[AlertRuleResponse.model_validate(r) for r in items],
        total=total,
        page=current_page,
        page_size=current_size,
        total_pages=total_pages,
    )


@router.post(
    "/alert-rules",
    response_model=AlertRuleResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles("admin"))],
)
def create_alert_rule(
    payload: AlertRuleCreate,
    db: Session = Depends(get_db),
) -> AlertRuleResponse:
    existing = db.execute(
        select(AlertRule).where(func.lower(AlertRule.name) == payload.name.strip().lower())
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"An alert rule named '{payload.name}' already exists.",
        )

    rule = AlertRule(
        name=payload.name.strip(),
        species_filter=payload.species_filter.strip() if payload.species_filter else None,
        risk_level=payload.risk_level,
        village_id=payload.village_id,
        zone_name=payload.zone_name.strip() if payload.zone_name else None,
        min_repeat_count=payload.min_repeat_count,
        time_window_minutes=payload.time_window_minutes,
        min_species_confidence=payload.min_species_confidence,
        enabled=payload.enabled,
        auto_notify_officer=payload.auto_notify_officer,
        auto_dispatch_iot_boundary=payload.auto_dispatch_iot_boundary,
        description=payload.description.strip() if payload.description else None,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return AlertRuleResponse.model_validate(rule)


@router.patch(
    "/alert-rules/{rule_id}",
    response_model=AlertRuleResponse,
    dependencies=[Depends(require_roles("admin"))],
)
def update_alert_rule(
    rule_id: uuid.UUID,
    payload: AlertRuleUpdate,
    db: Session = Depends(get_db),
) -> AlertRuleResponse:
    rule = db.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert rule not found.",
        )
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        if isinstance(value, str):
            value = value.strip() or None
        setattr(rule, field, value)
    db.commit()
    db.refresh(rule)
    return AlertRuleResponse.model_validate(rule)


@router.delete("/alert-rules/{rule_id}", dependencies=[Depends(require_roles("admin"))])
def delete_alert_rule(
    rule_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    rule = db.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert rule not found.",
        )
    db.delete(rule)
    db.commit()
    return {"status": "deleted", "id": str(rule_id)}


@router.get(
    "/officers",
    response_model=PaginatedResponse[ForestOfficerResponse],
    dependencies=[Depends(require_roles("operator"))],
)
def list_forest_officers(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    on_duty: bool | None = Query(default=None),
    db: Session = Depends(get_db),
) -> PaginatedResponse[ForestOfficerResponse]:
    stmt = select(ForestOfficer)
    if on_duty is not None:
        stmt = stmt.where(ForestOfficer.on_duty.is_(on_duty))
    stmt = stmt.order_by(ForestOfficer.on_duty.desc(), ForestOfficer.name.asc())
    items, total, current_page, current_size, total_pages = paginate_select(
        db, stmt, page, page_size
    )
    return PaginatedResponse[ForestOfficerResponse](
        items=[ForestOfficerResponse.model_validate(o) for o in items],
        total=total,
        page=current_page,
        page_size=current_size,
        total_pages=total_pages,
    )


@router.get(
    "/deliveries",
    response_model=PaginatedResponse[AlertDeliveryAttemptResponse],
    dependencies=[Depends(require_roles("operator"))],
)
def list_alert_delivery_attempts(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    alert_id: uuid.UUID | None = Query(default=None),
    db: Session = Depends(get_db),
) -> PaginatedResponse[AlertDeliveryAttemptResponse]:
    stmt = select(AlertDeliveryAttempt)
    if alert_id is not None:
        stmt = stmt.where(AlertDeliveryAttempt.alert_id == alert_id)
    stmt = stmt.order_by(AlertDeliveryAttempt.attempted_at.desc())
    items, total, current_page, current_size, total_pages = paginate_select(
        db, stmt, page, page_size
    )
    return PaginatedResponse[AlertDeliveryAttemptResponse](
        items=[AlertDeliveryAttemptResponse.model_validate(d) for d in items],
        total=total,
        page=current_page,
        page_size=current_size,
        total_pages=total_pages,
    )
