from datetime import datetime
from typing import Any, Literal
import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import NonEmptyStr, SeverityLiteral


class AnimalIdentitySummaryResponse(BaseModel):
    id: uuid.UUID
    animal_code: str
    species: str
    scientific_name: str | None = None
    species_prefix: str
    status: str
    verification_status: str
    primary_crop_url: str | None = None
    first_seen_at: datetime
    last_seen_at: datetime
    total_sightings: int
    reference_image_count: int
    notes: str | None = None
    created_at: datetime
    updated_at: datetime


class AnimalEmbeddingImageResponse(BaseModel):
    id: uuid.UUID
    detection_id: uuid.UUID
    detection_item_index: int
    animal_identity_id: uuid.UUID | None = None
    crop_image_url: str
    source_image_url: str
    species: str
    model_name: str
    model_version: str
    embedding_dim: int
    crop_width: int
    crop_height: int
    blur_score: float
    quality_passed: bool
    is_reference: bool
    created_at: datetime


class IdentityReviewLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    match_id: uuid.UUID
    animal_identity_id: uuid.UUID | None = None
    previous_animal_id: uuid.UUID | None = None
    action: str
    reviewed_by: str
    reviewed_at: datetime
    reason: str | None = None


class ReidMatchResponse(BaseModel):
    id: uuid.UUID
    detection_id: uuid.UUID
    embedding_id: uuid.UUID
    detection_item_index: int
    species: str
    matched_animal_id: uuid.UUID | None = None
    matched_animal_code: str | None = None
    suggested_animal_id: uuid.UUID | None = None
    suggested_animal_code: str | None = None
    similarity_score: float | None = None
    decision: str
    review_status: str
    review_reason: str | None = None
    top_candidates: list[dict[str, Any]] = Field(default_factory=list)
    crop_image_url: str
    source_image_url: str
    model_version: str
    thresholds_snapshot: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class AnimalIdentityDetailResponse(AnimalIdentitySummaryResponse):
    images: list[AnimalEmbeddingImageResponse] = Field(default_factory=list)
    matches: list[ReidMatchResponse] = Field(default_factory=list)
    review_logs: list[IdentityReviewLogResponse] = Field(default_factory=list)


class ReidReviewRequest(BaseModel):
    action: Literal["confirm", "reject", "mark_needs_review", "reassign"]
    reviewed_by: str | None = Field(default=None, max_length=160)
    reason: str | None = Field(default=None, max_length=2000)
    target_animal_identity_id: uuid.UUID | None = None
    create_new_identity: bool = False


class AlertRuleCreate(BaseModel):
    name: NonEmptyStr = Field(..., max_length=160)
    species_filter: str | None = Field(default=None, max_length=160)
    risk_level: SeverityLiteral = "High"
    village_id: uuid.UUID | None = None
    zone_name: str | None = Field(default=None, max_length=160)
    min_repeat_count: int = Field(default=1, ge=1, le=50)
    time_window_minutes: int = Field(default=120, ge=1, le=10080)
    min_species_confidence: float = Field(default=0.50, ge=0.0, le=1.0)
    enabled: bool = True
    auto_notify_officer: bool = True
    auto_dispatch_iot_boundary: bool = False
    description: str | None = Field(default=None, max_length=2000)


class AlertRuleUpdate(BaseModel):
    name: NonEmptyStr | None = Field(default=None, max_length=160)
    species_filter: str | None = Field(default=None, max_length=160)
    risk_level: SeverityLiteral | None = None
    village_id: uuid.UUID | None = None
    zone_name: str | None = Field(default=None, max_length=160)
    min_repeat_count: int | None = Field(default=None, ge=1, le=50)
    time_window_minutes: int | None = Field(default=None, ge=1, le=10080)
    min_species_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    enabled: bool | None = None
    auto_notify_officer: bool | None = None
    auto_dispatch_iot_boundary: bool | None = None
    description: str | None = Field(default=None, max_length=2000)


class AlertRuleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    species_filter: str | None = None
    risk_level: str
    village_id: uuid.UUID | None = None
    zone_name: str | None = None
    min_repeat_count: int
    time_window_minutes: int
    min_species_confidence: float
    enabled: bool
    auto_notify_officer: bool
    auto_dispatch_iot_boundary: bool
    description: str | None = None
    created_at: datetime
    updated_at: datetime


class ForestOfficerResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    badge_number: str
    role: str
    forest_range: str
    district: str
    latitude: float | None = None
    longitude: float | None = None
    whatsapp_opt_in: bool
    sms_opt_in: bool
    contact_channel: str
    duty_status: str
    on_duty: bool
    notification_enabled: bool
    created_at: datetime
    updated_at: datetime


class AlertDeliveryAttemptResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    alert_id: uuid.UUID
    officer_id: uuid.UUID | None = None
    officer_name: str
    channel: str
    routing_basis: str
    distance_km: float | None = None
    status: str
    attempt_number: int
    detail: str | None = None
    attempted_at: datetime


class IotDevTestCreate(BaseModel):
    camera_id: uuid.UUID | None = None
    device_code: NonEmptyStr = Field(..., max_length=64)
    species: NonEmptyStr = Field(..., max_length=160)
    animal_identity_id: uuid.UUID | None = None
    confidence: float = Field(default=0.85, ge=0.0, le=1.0)
    risk_level: SeverityLiteral = "High"
    alert_id: uuid.UUID | None = None


class IotAckRequest(BaseModel):
    acknowledged_by: str | None = Field(default=None, max_length=160)
    ack_note: str | None = Field(default=None, max_length=1000)


class IotEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    alert_id: uuid.UUID | None = None
    camera_id: uuid.UUID | None = None
    device_code: str
    animal_identity_id: uuid.UUID | None = None
    species: str
    confidence: float
    risk_level: str
    event_type: str
    is_dev_test: bool
    payload_json: dict[str, Any]
    delivery_status: str
    retry_count: int
    acknowledged_at: datetime | None = None
    acknowledged_by: str | None = None
    ack_note: str | None = None
    created_at: datetime
    updated_at: datetime
