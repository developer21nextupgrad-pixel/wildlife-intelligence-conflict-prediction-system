from datetime import datetime
from typing import Any
import uuid

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import GUID, PortableVector, TimestampMixin, utc_now


class AnimalCodeSequence(Base):
    """Transactional per-species counter for generating persistent human-readable animal codes (e.g. ELE-001)."""

    __tablename__ = "animal_code_sequences"

    species_prefix: Mapped[str] = mapped_column(String(16), primary_key=True)
    last_number: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class AnimalIdentity(TimestampMixin, Base):
    __tablename__ = "animal_identities"
    __table_args__ = (
        CheckConstraint("total_sightings >= 0", name="ck_animal_identities_sightings"),
        CheckConstraint("reference_image_count >= 0", name="ck_animal_identities_ref_count"),
        Index("ix_animal_identities_species_status", "species", "status"),
        Index("ix_animal_identities_family_status", "species_family", "status"),
        Index("ix_animal_identities_last_seen_at", "last_seen_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    animal_code: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    species: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    species_family: Mapped[str] = mapped_column(
        String(64), nullable=False, default="unknown", index=True
    )
    scientific_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    species_prefix: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    verification_status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="provisional"
    )
    primary_crop_object_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    total_sightings: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    reference_image_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class AnimalEmbedding(Base):
    __tablename__ = "animal_embeddings"
    __table_args__ = (
        CheckConstraint("embedding_dim > 0", name="ck_animal_embeddings_dim"),
        CheckConstraint("detection_item_index >= 1", name="ck_animal_embeddings_item_idx"),
        Index("ix_animal_embeddings_species_ref", "species", "is_reference"),
        Index("ix_animal_embeddings_family_ref", "species_family", "is_reference"),
        Index("ix_animal_embeddings_identity_id", "animal_identity_id"),
        Index("ix_animal_embeddings_detection_id", "detection_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    detection_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("animal_detections.id", ondelete="CASCADE"), nullable=False
    )
    detection_item_index: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    animal_identity_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("animal_identities.id", ondelete="SET NULL"), nullable=True
    )
    crop_object_key: Mapped[str] = mapped_column(String(512), nullable=False)
    species: Mapped[str] = mapped_column(String(160), nullable=False)
    species_family: Mapped[str] = mapped_column(
        String(64), nullable=False, default="unknown", index=True
    )
    model_name: Mapped[str] = mapped_column(String(160), nullable=False)
    model_version: Mapped[str] = mapped_column(String(64), nullable=False)
    embedding_dim: Mapped[int] = mapped_column(Integer, nullable=False, default=768)
    embedding: Mapped[list[float]] = mapped_column(PortableVector(768), nullable=False)
    crop_width: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    crop_height: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    blur_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    quality_passed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_reference: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )


class ReidMatch(TimestampMixin, Base):
    __tablename__ = "reid_matches"
    __table_args__ = (
        Index("ix_reid_matches_detection_id", "detection_id"),
        Index("ix_reid_matches_matched_animal_id", "matched_animal_id"),
        Index("ix_reid_matches_review_status", "review_status"),
        Index("ix_reid_matches_decision", "decision"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    detection_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("animal_detections.id", ondelete="CASCADE"), nullable=False
    )
    embedding_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("animal_embeddings.id", ondelete="CASCADE"), nullable=False
    )
    detection_item_index: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    species: Mapped[str] = mapped_column(String(160), nullable=False)
    matched_animal_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("animal_identities.id", ondelete="SET NULL"), nullable=True
    )
    suggested_animal_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("animal_identities.id", ondelete="SET NULL"), nullable=True
    )
    similarity_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    decision: Mapped[str] = mapped_column(String(32), nullable=False)
    review_status: Mapped[str] = mapped_column(String(32), nullable=False)
    review_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    top_candidates: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON, nullable=False, default=list
    )
    model_version: Mapped[str] = mapped_column(String(160), nullable=False)
    thresholds_snapshot: Mapped[dict[str, Any]] = mapped_column(
        JSON, nullable=False, default=dict
    )


class IdentityReviewLog(Base):
    __tablename__ = "identity_review_logs"
    __table_args__ = (
        Index("ix_identity_review_logs_match_id", "match_id"),
        Index("ix_identity_review_logs_reviewed_at", "reviewed_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    match_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("reid_matches.id", ondelete="CASCADE"), nullable=False
    )
    animal_identity_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("animal_identities.id", ondelete="SET NULL"), nullable=True
    )
    previous_animal_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("animal_identities.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    reviewed_by: Mapped[str] = mapped_column(String(160), nullable=False)
    reviewed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class AlertRule(TimestampMixin, Base):
    __tablename__ = "alert_rules"
    __table_args__ = (
        CheckConstraint("min_repeat_count >= 1", name="ck_alert_rules_min_repeat"),
        CheckConstraint("time_window_minutes >= 1", name="ck_alert_rules_window"),
        Index("ix_alert_rules_enabled_species", "enabled", "species_filter"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(160), nullable=False, unique=True)
    species_filter: Mapped[str | None] = mapped_column(String(160), nullable=True)
    risk_level: Mapped[str] = mapped_column(String(32), nullable=False, default="High")
    village_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("villages.id", ondelete="SET NULL"), nullable=True, index=True
    )
    zone_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    min_repeat_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    time_window_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=120)
    min_species_confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.50)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    auto_notify_officer: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    auto_dispatch_iot_boundary: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)


class ForestOfficer(TimestampMixin, Base):
    __tablename__ = "forest_officers"
    __table_args__ = (
        Index("ix_forest_officers_range_duty", "forest_range", "on_duty"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    badge_number: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    role: Mapped[str] = mapped_column(String(120), nullable=False)
    forest_range: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    district: Mapped[str] = mapped_column(
        String(120), nullable=False, default="Bandipur Division"
    )
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    whatsapp_opt_in: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sms_opt_in: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    contact_channel: Mapped[str] = mapped_column(
        String(32), nullable=False, default="whatsapp_stub"
    )
    duty_status: Mapped[str] = mapped_column(String(48), nullable=False, default="On Duty")
    on_duty: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    notification_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class AlertDeliveryAttempt(Base):
    __tablename__ = "alert_delivery_attempts"
    __table_args__ = (
        Index("ix_alert_delivery_attempts_alert_id", "alert_id"),
        Index("ix_alert_delivery_attempts_officer_id", "officer_id"),
        Index("ix_alert_delivery_attempts_attempted_at", "attempted_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    alert_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("alerts.id", ondelete="CASCADE"), nullable=False
    )
    officer_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("forest_officers.id", ondelete="SET NULL"), nullable=True
    )
    officer_name: Mapped[str] = mapped_column(String(160), nullable=False)
    channel: Mapped[str] = mapped_column(String(32), nullable=False)
    routing_basis: Mapped[str] = mapped_column(String(48), nullable=False)
    distance_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(48), nullable=False)
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    attempted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )


class IotEventRecord(TimestampMixin, Base):
    __tablename__ = "iot_event_records"
    __table_args__ = (
        CheckConstraint("retry_count >= 0", name="ck_iot_event_records_retries"),
        Index("ix_iot_event_records_status", "delivery_status"),
        Index("ix_iot_event_records_camera_id", "camera_id"),
        Index("ix_iot_event_records_alert_id", "alert_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    alert_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("alerts.id", ondelete="CASCADE"), nullable=True
    )
    camera_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("cameras.id", ondelete="SET NULL"), nullable=True
    )
    device_code: Mapped[str] = mapped_column(String(64), nullable=False)
    animal_identity_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("animal_identities.id", ondelete="SET NULL"), nullable=True
    )
    species: Mapped[str] = mapped_column(String(160), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    risk_level: Mapped[str] = mapped_column(String(32), nullable=False, default="High")
    event_type: Mapped[str] = mapped_column(
        String(64), nullable=False, default="boundary_alert_dispatch"
    )
    is_dev_test: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    delivery_status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="pending_ack"
    )
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    acknowledged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    acknowledged_by: Mapped[str | None] = mapped_column(String(160), nullable=True)
    ack_note: Mapped[str | None] = mapped_column(Text, nullable=True)
