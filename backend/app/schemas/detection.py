from datetime import datetime
from typing import Any, Literal
import uuid

from pydantic import BaseModel, Field


class BoundingBoxResponse(BaseModel):
    xmin: float = Field(..., ge=0.0, le=1.0)
    ymin: float = Field(..., ge=0.0, le=1.0)
    width: float = Field(..., ge=0.0, le=1.0)
    height: float = Field(..., ge=0.0, le=1.0)
    pixel_xmin: int = Field(..., ge=0)
    pixel_ymin: int = Field(..., ge=0)
    pixel_width: int = Field(..., ge=0)
    pixel_height: int = Field(..., ge=0)


class ClassificationCandidateResponse(BaseModel):
    species_label: str
    common_name: str | None = None
    scientific_name: str | None = None
    confidence: float = Field(..., ge=0.0, le=1.0)


class ReidCandidateResponse(BaseModel):
    animal_identity_id: str
    animal_code: str
    species: str
    similarity_score: float = Field(..., ge=-1.0, le=1.0)
    crop_image_url: str | None = None


class CropQualitySummaryResponse(BaseModel):
    passed: bool
    reason: str | None = None
    width: int = 0
    height: int = 0
    blur_score: float = 0.0


class DetectionItemResponse(BaseModel):
    index: int = Field(..., ge=1)
    category: Literal["animal", "human", "vehicle"]
    detector_confidence: float = Field(..., ge=0.0, le=1.0)
    bbox: BoundingBoxResponse
    species_label: str
    common_name: str | None = None
    scientific_name: str | None = None
    taxonomic_level: str | None = None
    taxonomy_raw: str | None = None
    species_confidence: float = Field(..., ge=0.0, le=1.0)
    prediction_source: str | None = None
    needs_review: bool = False
    top_candidates: list[ClassificationCandidateResponse] = Field(default_factory=list)
    individual_reid_status: str = "phase2_not_enabled"
    reid_match_id: str | None = None
    embedding_id: str | None = None
    animal_identity_id: str | None = None
    animal_code: str | None = None
    reid_decision: str | None = None
    reid_review_status: str | None = None
    reid_similarity_score: float | None = None
    reid_review_reason: str | None = None
    reid_top_candidates: list[ReidCandidateResponse] = Field(default_factory=list)
    crop_object_key: str | None = None
    crop_image_url: str | None = None
    crop_quality: CropQualitySummaryResponse | None = None


class AnimalDetectionModelMetadata(BaseModel):
    detector_model: str
    classifier_model: str
    speciesnet_version: str
    geofence_enabled: bool
    country_code: str | None = None
    admin1_region: str | None = None
    min_detection_confidence: float
    min_species_confidence: float
    thermal_imagery_supported: bool = False
    imagery_notice: str
    reid_enabled: bool = False
    reid_model: str | None = None
    reid_license: str | None = None
    reid_match_threshold: float | None = None
    reid_ambiguous_threshold: float | None = None


class LinkedAlertSummary(BaseModel):
    id: uuid.UUID
    title: str
    severity: str
    affected_village: str
    assigned_officer: str | None = None
    response_status: str
    risk_reason: str | None = None


class AnimalDetectionResponse(BaseModel):
    id: uuid.UUID
    source_filename: str
    content_type: str
    file_size_bytes: int
    width: int
    height: int
    image_object_key: str
    image_url: str
    storage_backend: str
    processing_status: Literal["completed", "no_animal_detected", "needs_review", "failed"]
    detection_count: int
    animal_count: int
    primary_species: str | None = None
    primary_common_name: str | None = None
    primary_scientific_name: str | None = None
    primary_confidence: float | None = None
    country_code: str | None = None
    admin1_region: str | None = None
    camera_id: uuid.UUID | None = None
    village_id: uuid.UUID | None = None
    captured_at: datetime | None = None
    latitude: float | None = None
    longitude: float | None = None
    location_name: str | None = None
    idempotency_key: str | None = None
    generated_sighting_id: uuid.UUID | None = None
    sighting_integration_status: str | None = None
    generated_alert_ids: list[str] = Field(default_factory=list)
    generated_alerts: list[LinkedAlertSummary] = Field(default_factory=list)
    detector_model: str
    classifier_model: str
    inference_duration_ms: int
    detections: list[DetectionItemResponse]
    model_metadata: AnimalDetectionModelMetadata
    error_message: str | None = None
    uploaded_by_user_id: uuid.UUID | None = None
    can_delete: bool = False
    is_deleted: bool = False
    deleted_at: datetime | None = None
    deleted_by: str | None = None
    created_at: datetime
    updated_at: datetime


class AnimalDetectionListResponse(BaseModel):
    items: list[AnimalDetectionResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
    eligible_clear_count: int = 0


class AnimalDetectionDeleteResponse(BaseModel):
    status: Literal["archived"] = "archived"
    id: uuid.UUID
    source_filename: str
    deleted_at: datetime
    deleted_by: str
    storage_cleaned: bool = False
    storage_preserved_reason: str | None = None


class AnimalDetectionClearResponse(BaseModel):
    status: Literal["cleared"] = "cleared"
    cleared_count: int
    skipped_unauthorized_count: int = 0
    storage_objects_cleaned: int = 0
    storage_objects_preserved: int = 0
