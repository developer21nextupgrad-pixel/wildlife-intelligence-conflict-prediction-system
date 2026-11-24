"""Phase 2 Individual Animal Re-Identification service (pgvector + MegaDescriptor + review audit)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import io
import logging
import re
from typing import Any
import uuid

import numpy as np
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.config import Settings
from app.core.database import is_postgres_backend
from app.models import (
    Alert,
    AnimalCodeSequence,
    AnimalDetection,
    AnimalEmbedding,
    AnimalIdentity,
    IdentityReviewLog,
    ReidMatch,
    Sighting,
)
from app.services.megadescriptor import (
    CropQualityResult,
    MegaDescriptorExtractor,
    assess_crop_quality,
)
from app.services.storage import ObjectStorageBackend

logger = logging.getLogger("wicps.reid")

_SPECIES_FAMILY_ALIASES: list[tuple[tuple[str, ...], str, str]] = [
    (("elephantidae", "asian elephant", "indian elephant", "elephas", "elephant"), "elephant", "ELE"),
    (("panthera tigris", "bengal tiger", "tiger"), "tiger", "TIG"),
    (("panthera pardus", "indian leopard", "leopard"), "leopard", "LEO"),
    (("melursus ursinus", "sloth bear"), "sloth_bear", "SLB"),
    (("sus scrofa", "wild boar"), "wild_boar", "WBR"),
    (("bos gaurus", "gaur", "indian bison"), "gaur", "GAU"),
    (("cuon alpinus", "dhole", "indian wild dog"), "dhole", "DHL"),
    (("rusa unicolor", "sambar"), "sambar", "SMB"),
    (("axis axis", "chital", "spotted deer"), "chital", "CHT"),
]


def normalize_species_family(species: str | None) -> tuple[str, str]:
    """Maps SpeciesNet labels and WICPS species names to a canonical family key + 3-letter ID prefix."""
    raw = (species or "").strip().lower()
    if not raw or raw in {"unknown", "unknown / needs review", "blank", "animal"}:
        return ("unknown", "ANM")

    for keywords, family_key, prefix in _SPECIES_FAMILY_ALIASES:
        if any(kw in raw for kw in keywords):
            return (family_key, prefix)

    cleaned = re.sub(r"[^a-z]", "", raw)
    prefix = (cleaned[:3] if len(cleaned) >= 3 else (cleaned + "XXX")[:3]).upper()
    return (re.sub(r"\s+", "_", raw), prefix)


def canonical_species_display(species: str | None) -> str:
    """Normalizes common SpeciesNet outputs into clean WICPS registry species labels when matched."""
    raw = (species or "").strip()
    family, _ = normalize_species_family(raw)
    mapping = {
        "elephant": "Asian Elephant",
        "tiger": "Bengal Tiger",
        "leopard": "Indian Leopard",
        "sloth_bear": "Sloth Bear",
        "wild_boar": "Wild Boar",
        "gaur": "Gaur",
    }
    return mapping.get(family, raw or "Unknown Wildlife")


def _encode_crop_jpeg(crop: Image.Image) -> bytes:
    buf = io.BytesIO()
    crop.convert("RGB").save(buf, format="JPEG", quality=92)
    return buf.getvalue()


def allocate_animal_code(db: Session, species: str | None) -> tuple[str, str]:
    """Concurrency-safe persistent animal code allocator (e.g. ELE-001, TIG-002)."""
    _family, prefix = normalize_species_family(species)

    # Ensure sequence floor stays >= max existing numeric suffix for this prefix
    existing_codes = list(
        db.execute(
            select(AnimalIdentity.animal_code).where(
                AnimalIdentity.species_prefix == prefix
            )
        )
        .scalars()
        .all()
    )
    existing_max = 0
    for code in existing_codes:
        m = re.search(r"-(\d+)$", code or "")
        if m:
            existing_max = max(existing_max, int(m.group(1)))

    if is_postgres_backend(db):
        stmt = (
            pg_insert(AnimalCodeSequence)
            .values(species_prefix=prefix, last_number=max(1, existing_max + 1))
            .on_conflict_do_update(
                index_elements=[AnimalCodeSequence.species_prefix],
                set_={
                    "last_number": func.greatest(
                        AnimalCodeSequence.last_number + 1, existing_max + 1
                    )
                },
            )
            .returning(AnimalCodeSequence.last_number)
        )
        next_num = int(db.execute(stmt).scalar_one())
    else:
        stmt = (
            sqlite_insert(AnimalCodeSequence)
            .values(species_prefix=prefix, last_number=max(1, existing_max + 1))
            .on_conflict_do_update(
                index_elements=[AnimalCodeSequence.species_prefix],
                set_={
                    "last_number": func.max(
                        AnimalCodeSequence.last_number + 1, existing_max + 1
                    )
                },
            )
            .returning(AnimalCodeSequence.last_number)
        )
        next_num = int(db.execute(stmt).scalar_one())

    return f"{prefix}-{next_num:03d}", prefix


@dataclass
class CandidateMatch:
    animal_identity_id: uuid.UUID
    animal_code: str
    species: str
    similarity_score: float
    crop_object_key: str
    reference_embedding_id: uuid.UUID


def find_similar_individuals(
    db: Session,
    *,
    query_embedding: list[float],
    species_label: str,
    limit: int = 5,
) -> list[CandidateMatch]:
    """Finds top matching individual identities within the same species family using cosine similarity."""
    target_family, _ = normalize_species_family(species_label)
    if target_family == "unknown":
        return []

    query_vec = np.asarray(query_embedding, dtype=np.float32)
    q_norm = float(np.linalg.norm(query_vec))
    if q_norm <= 1e-12:
        return []
    query_vec = query_vec / q_norm

    best_by_identity: dict[uuid.UUID, CandidateMatch] = {}

    if is_postgres_backend(db):
        dist_col = AnimalEmbedding.embedding.cosine_distance(query_vec.tolist()).label("dist")
        rows = db.execute(
            select(AnimalEmbedding, AnimalIdentity, dist_col)
            .join(AnimalIdentity, AnimalEmbedding.animal_identity_id == AnimalIdentity.id)
            .where(
                AnimalEmbedding.is_reference.is_(True),
                AnimalEmbedding.animal_identity_id.is_not(None),
                AnimalEmbedding.species_family == target_family,
                AnimalIdentity.species_family == target_family,
                AnimalIdentity.status != "retired",
            )
            .order_by(dist_col.asc())
            .limit(max(20, limit * 5))
        ).all()

        for emb, identity, dist in rows:
            sim = float(max(-1.0, min(1.0, 1.0 - float(dist))))
            existing = best_by_identity.get(identity.id)
            if existing is None or sim > existing.similarity_score:
                best_by_identity[identity.id] = CandidateMatch(
                    animal_identity_id=identity.id,
                    animal_code=identity.animal_code,
                    species=identity.species,
                    similarity_score=round(sim, 4),
                    crop_object_key=emb.crop_object_key,
                    reference_embedding_id=emb.id,
                )
    else:
        rows = db.execute(
            select(AnimalEmbedding, AnimalIdentity)
            .join(AnimalIdentity, AnimalEmbedding.animal_identity_id == AnimalIdentity.id)
            .where(
                AnimalEmbedding.is_reference.is_(True),
                AnimalEmbedding.animal_identity_id.is_not(None),
                AnimalEmbedding.species_family == target_family,
                AnimalIdentity.species_family == target_family,
                AnimalIdentity.status != "retired",
            )
        ).all()
        for emb, identity in rows:
            cand_vec = np.asarray(emb.embedding, dtype=np.float32)
            c_norm = float(np.linalg.norm(cand_vec))
            if c_norm <= 1e-12:
                continue
            sim = float(np.dot(query_vec, cand_vec / c_norm))
            sim = float(max(-1.0, min(1.0, sim)))
            existing = best_by_identity.get(identity.id)
            if existing is None or sim > existing.similarity_score:
                best_by_identity[identity.id] = CandidateMatch(
                    animal_identity_id=identity.id,
                    animal_code=identity.animal_code,
                    species=identity.species,
                    similarity_score=round(sim, 4),
                    crop_object_key=emb.crop_object_key,
                    reference_embedding_id=emb.id,
                )

    ranked = sorted(
        best_by_identity.values(),
        key=lambda c: c.similarity_score,
        reverse=True,
    )
    return ranked[:limit]


def recompute_identity_stats(db: Session, identity_id: uuid.UUID) -> None:
    """Recomputes reference image count cleanly after review reassignment or rejection."""
    identity = db.get(AnimalIdentity, identity_id)
    if not identity:
        return
    ref_count = int(
        db.execute(
            select(func.count(AnimalEmbedding.id)).where(
                AnimalEmbedding.animal_identity_id == identity_id,
                AnimalEmbedding.is_reference.is_(True),
            )
        ).scalar_one()
        or 0
    )
    matched_count = int(
        db.execute(
            select(func.count(ReidMatch.id)).where(
                ReidMatch.matched_animal_id == identity_id
            )
        ).scalar_one()
        or 0
    )
    identity.reference_image_count = ref_count
    identity.total_sightings = max(1 if ref_count > 0 else 0, matched_count)


def run_reid_for_detection(
    db: Session,
    *,
    detection: AnimalDetection,
    pil_image: Image.Image,
    storage: ObjectStorageBackend,
    extractor: MegaDescriptorExtractor,
    settings: Settings,
    observed_at: datetime,
) -> list[dict[str, Any]]:
    """Extracts crop embeddings, runs pgvector similarity matching, and persists Re-ID records."""
    items = list(detection.detections or [])
    if not items or not settings.megadescriptor_enabled:
        return items

    width, height = pil_image.size
    date_prefix = observed_at.astimezone(timezone.utc).strftime("%Y-%m-%d")
    thresholds_snapshot = {
        "match_threshold": settings.reid_match_threshold,
        "ambiguous_threshold": settings.reid_ambiguous_threshold,
        "margin_threshold": settings.reid_margin_threshold,
        "min_crop_px": settings.reid_min_crop_px,
        "min_blur_laplacian": settings.reid_min_blur_laplacian,
    }
    api_prefix = settings.api_v1_prefix.rstrip("/")

    updated_items: list[dict[str, Any]] = []
    for raw_item in items:
        item = dict(raw_item)
        if item.get("category") != "animal":
            item["individual_reid_status"] = "not_applicable"
            updated_items.append(item)
            continue

        idx = int(item.get("index", len(updated_items) + 1))
        bbox = item.get("bbox") or {}
        x0 = max(0, int(bbox.get("pixel_xmin", 0)))
        y0 = max(0, int(bbox.get("pixel_ymin", 0)))
        pw = max(1, int(bbox.get("pixel_width", width - x0)))
        ph = max(1, int(bbox.get("pixel_height", height - y0)))
        x1 = min(width, x0 + pw)
        y1 = min(height, y0 + ph)
        crop_img = pil_image.crop((x0, y0, x1, y1)) if x1 > x0 and y1 > y0 else pil_image

        crop_bytes = _encode_crop_jpeg(crop_img)
        crop_object_key = storage.put_bytes(
            f"animal-crops/{date_prefix}/{detection.id}_{idx}.jpg",
            crop_bytes,
            content_type="image/jpeg",
        )

        quality: CropQualityResult = assess_crop_quality(
            crop_img,
            min_crop_px=settings.reid_min_crop_px,
            min_blur_laplacian=settings.reid_min_blur_laplacian,
        )
        embedding_vec = extractor.extract_embedding(crop_img)
        raw_species = item.get("common_name") or item.get("species_label") or "Unknown Wildlife"
        species_norm = canonical_species_display(raw_species)

        candidates = (
            find_similar_individuals(
                db,
                query_embedding=embedding_vec,
                species_label=raw_species,
                limit=5,
            )
            if not item.get("needs_review")
            else []
        )

        best = candidates[0] if candidates else None
        second = candidates[1] if len(candidates) >= 2 else None
        best_score = best.similarity_score if best else None

        matched_identity: AnimalIdentity | None = None
        suggested_identity_id: uuid.UUID | None = best.animal_identity_id if best else None
        decision: str
        review_status: str
        review_reason: str
        is_reference = False

        if item.get("needs_review"):
            decision = "needs_review"
            review_status = "pending_review"
            review_reason = (
                "Species identification requires manual verification before individual assignment."
            )
            suggested_identity_id = None
        elif not quality.quality_passed:
            decision = "needs_review"
            review_status = "pending_review"
            review_reason = (
                f"Crop quality check flagged ({quality.reason}; "
                f"{quality.crop_width}x{quality.crop_height}px, blur={quality.blur_score:.1f}). "
                "Requires human confirmation before linking to an individual."
            )
            if best_score is not None and best_score < settings.reid_ambiguous_threshold:
                suggested_identity_id = None
        elif best is not None and best.similarity_score >= settings.reid_match_threshold:
            if (
                second is not None
                and second.similarity_score >= settings.reid_ambiguous_threshold
                and (best.similarity_score - second.similarity_score) < settings.reid_margin_threshold
            ):
                decision = "needs_review"
                review_status = "pending_review"
                review_reason = (
                    f"Close probabilistic tie between {best.animal_code} ({best.similarity_score:.3f}) "
                    f"and {second.animal_code} ({second.similarity_score:.3f}); "
                    "similarity alone does not prove biological identity."
                )
            else:
                decision = "matched_existing"
                review_status = "auto_accepted"
                matched_identity = db.get(AnimalIdentity, best.animal_identity_id)
                is_reference = True
                review_reason = (
                    f"Visual similarity {best.similarity_score:.3f} >= {settings.reid_match_threshold:.2f} "
                    f"with {best.animal_code} (probabilistic MegaDescriptor visual match)."
                )
                if matched_identity is not None:
                    matched_identity.last_seen_at = max(
                        matched_identity.last_seen_at.replace(tzinfo=timezone.utc)
                        if matched_identity.last_seen_at.tzinfo is None
                        else matched_identity.last_seen_at,
                        observed_at,
                    )
                    matched_identity.total_sightings += 1
                    matched_identity.reference_image_count += 1
        elif best is not None and best.similarity_score >= settings.reid_ambiguous_threshold:
            decision = "needs_review"
            review_status = "pending_review"
            review_reason = (
                f"Ambiguous similarity ({best.similarity_score:.3f}) in review band "
                f"[{settings.reid_ambiguous_threshold:.2f}, {settings.reid_match_threshold:.2f}) "
                f"against {best.animal_code}; manual review required."
            )
        else:
            animal_code, prefix = allocate_animal_code(db, species_norm)
            species_family_val, _ = normalize_species_family(species_norm)
            matched_identity = AnimalIdentity(
                animal_code=animal_code,
                species=species_norm,
                species_family=species_family_val,
                scientific_name=item.get("scientific_name"),
                species_prefix=prefix,
                status="active",
                verification_status="provisional",
                primary_crop_object_key=crop_object_key,
                first_seen_at=observed_at,
                last_seen_at=observed_at,
                total_sightings=1,
                reference_image_count=1,
            )
            db.add(matched_identity)
            db.flush()
            decision = "new_individual"
            review_status = "auto_accepted"
            suggested_identity_id = matched_identity.id
            is_reference = True
            review_reason = (
                f"No reference exceeded ambiguity threshold ({settings.reid_ambiguous_threshold:.2f}); "
                f"assigned new provisional ID {animal_code}."
            )

        emb_family, _ = normalize_species_family(species_norm)
        embedding_row = AnimalEmbedding(
            detection_id=detection.id,
            detection_item_index=idx,
            animal_identity_id=matched_identity.id if matched_identity else None,
            crop_object_key=crop_object_key,
            species=species_norm,
            species_family=emb_family,
            model_name=extractor.model_name,
            model_version=extractor.model_version,
            embedding_dim=len(embedding_vec),
            embedding=embedding_vec,
            crop_width=quality.crop_width,
            crop_height=quality.crop_height,
            blur_score=quality.blur_score,
            quality_passed=quality.quality_passed,
            is_reference=is_reference,
        )
        db.add(embedding_row)
        db.flush()

        top_candidates_payload = [
            {
                "animal_identity_id": str(c.animal_identity_id),
                "animal_code": c.animal_code,
                "species": c.species,
                "similarity_score": c.similarity_score,
                "crop_image_url": f"{api_prefix}/animal-intelligence/crops/{c.reference_embedding_id}/image",
            }
            for c in candidates
        ]

        reid_match = ReidMatch(
            detection_id=detection.id,
            embedding_id=embedding_row.id,
            detection_item_index=idx,
            species=species_norm,
            matched_animal_id=matched_identity.id if matched_identity else None,
            suggested_animal_id=suggested_identity_id,
            similarity_score=best_score,
            decision=decision,
            review_status=review_status,
            review_reason=review_reason,
            top_candidates=top_candidates_payload,
            model_version=extractor.model_version,
            thresholds_snapshot=thresholds_snapshot,
        )
        db.add(reid_match)
        db.flush()

        crop_image_url = f"{api_prefix}/animal-intelligence/crops/{embedding_row.id}/image"
        item["individual_reid_status"] = decision
        item["reid_match_id"] = str(reid_match.id)
        item["embedding_id"] = str(embedding_row.id)
        item["animal_identity_id"] = str(matched_identity.id) if matched_identity else None
        item["animal_code"] = matched_identity.animal_code if matched_identity else None
        item["reid_decision"] = decision
        item["reid_review_status"] = review_status
        item["reid_similarity_score"] = best_score
        item["reid_review_reason"] = review_reason
        item["reid_top_candidates"] = top_candidates_payload
        item["crop_object_key"] = crop_object_key
        item["crop_image_url"] = crop_image_url
        item["crop_quality"] = {
            "passed": quality.quality_passed,
            "reason": quality.reason,
            "width": quality.crop_width,
            "height": quality.crop_height,
            "blur_score": quality.blur_score,
        }
        updated_items.append(item)

    detection.detections = updated_items
    flag_modified(detection, "detections")
    return updated_items


def apply_manual_review(
    db: Session,
    *,
    match: ReidMatch,
    action: str,
    reviewed_by: str,
    reason: str | None = None,
    target_animal_identity_id: uuid.UUID | None = None,
    create_new_identity: bool = False,
) -> ReidMatch:
    """Applies a human verification decision to a Re-ID match and appends an audit log.
    Never silently merges two animal identities.
    """
    embedding = db.get(AnimalEmbedding, match.embedding_id)
    detection = db.get(AnimalDetection, match.detection_id)
    previous_id = match.matched_animal_id
    now = datetime.now(timezone.utc)

    new_identity_id: uuid.UUID | None = None

    if action == "confirm":
        chosen_id = target_animal_identity_id or match.matched_animal_id or match.suggested_animal_id
        if not chosen_id:
            raise ValueError(
                "No target or suggested animal identity is available to confirm this match."
            )
        identity = db.get(AnimalIdentity, chosen_id)
        if not identity:
            raise ValueError("Referenced animal identity does not exist.")
        match.matched_animal_id = identity.id
        match.review_status = "confirmed"
        match.review_reason = reason or "Confirmed by human reviewer."
        identity.verification_status = "confirmed"
        identity.status = "active"
        if embedding is not None:
            embedding.animal_identity_id = identity.id
            embedding.is_reference = bool(embedding.quality_passed)
        new_identity_id = identity.id

    elif action == "reject":
        match.review_status = "rejected"
        match.decision = "rejected"
        match.review_reason = reason or "Match rejected by human reviewer."
        if create_new_identity:
            new_code, prefix = allocate_animal_code(db, match.species)
            new_family, _ = normalize_species_family(match.species)
            crop_key = embedding.crop_object_key if embedding else None
            created_identity = AnimalIdentity(
                animal_code=new_code,
                species=canonical_species_display(match.species),
                species_family=new_family,
                species_prefix=prefix,
                status="active",
                verification_status="confirmed",
                primary_crop_object_key=crop_key,
                first_seen_at=now,
                last_seen_at=now,
                total_sightings=1,
                reference_image_count=1 if (embedding and embedding.quality_passed) else 0,
                notes=f"Created upon manual rejection of prior suggestion ({reason or 'distinct individual'}).",
            )
            db.add(created_identity)
            db.flush()
            match.matched_animal_id = created_identity.id
            if embedding is not None:
                embedding.animal_identity_id = created_identity.id
                embedding.is_reference = bool(embedding.quality_passed)
            new_identity_id = created_identity.id
        else:
            match.matched_animal_id = None
            if embedding is not None:
                embedding.animal_identity_id = None
                embedding.is_reference = False
            new_identity_id = None

    elif action == "mark_needs_review":
        if match.matched_animal_id and not match.suggested_animal_id:
            match.suggested_animal_id = match.matched_animal_id
        match.matched_animal_id = None
        match.decision = "needs_review"
        match.review_status = "pending_review"
        match.review_reason = reason or "Flagged for human verification."
        if embedding is not None:
            embedding.animal_identity_id = None
            embedding.is_reference = False
        new_identity_id = None

    elif action == "reassign":
        if not target_animal_identity_id:
            raise ValueError("target_animal_identity_id is required for reassign action.")
        target_identity = db.get(AnimalIdentity, target_animal_identity_id)
        if not target_identity:
            raise ValueError("Target animal identity does not exist.")
        match.matched_animal_id = target_identity.id
        match.decision = "reassigned"
        match.review_status = "reassigned"
        match.review_reason = reason or f"Reassigned to {target_identity.animal_code} by reviewer."
        target_identity.verification_status = "confirmed"
        target_identity.status = "active"
        if embedding is not None:
            embedding.animal_identity_id = target_identity.id
            embedding.is_reference = bool(embedding.quality_passed)
        new_identity_id = target_identity.id

    else:
        raise ValueError(f"Unsupported review action: {action}")

    # Sync cached detection item metadata & linked sighting/alerts
    new_identity = db.get(AnimalIdentity, new_identity_id) if new_identity_id else None
    if detection is not None:
        updated_items: list[dict[str, Any]] = []
        for item in detection.detections or []:
            if int(item.get("index", 0)) == match.detection_item_index:
                item = dict(item)
                item["animal_identity_id"] = str(new_identity.id) if new_identity else None
                item["animal_code"] = new_identity.animal_code if new_identity else None
                item["reid_decision"] = match.decision
                item["individual_reid_status"] = match.decision
                item["reid_review_status"] = match.review_status
                item["reid_review_reason"] = match.review_reason
            updated_items.append(item)
        detection.detections = updated_items
        flag_modified(detection, "detections")

        # Update linked sighting and alerts if this match is for the lead detection item
        if match.detection_item_index == 1:
            linked_sightings = list(
                db.execute(
                    select(Sighting).where(Sighting.animal_detection_id == detection.id)
                )
                .scalars()
                .all()
            )
            for s in linked_sightings:
                s.animal_identity_id = new_identity_id
            linked_alerts = list(
                db.execute(
                    select(Alert).where(Alert.animal_detection_id == detection.id)
                )
                .scalars()
                .all()
            )
            for a in linked_alerts:
                a.animal_identity_id = new_identity_id

    if previous_id:
        recompute_identity_stats(db, previous_id)
    if new_identity_id and new_identity_id != previous_id:
        recompute_identity_stats(db, new_identity_id)

    log_entry = IdentityReviewLog(
        match_id=match.id,
        animal_identity_id=new_identity_id,
        previous_animal_id=previous_id,
        action=action,
        reviewed_by=reviewed_by.strip(),
        reviewed_at=now,
        reason=reason.strip() if reason else None,
    )
    db.add(log_entry)
    db.flush()
    return match
