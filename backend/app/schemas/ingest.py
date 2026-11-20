from datetime import datetime
from typing import Any, Literal
import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import LatitudeFloat, LongitudeFloat, NonEmptyStr

CaptureModeLiteral = Literal["http_push", "rtsp_test_pull", "dev_sample_upload"]
ProcessingStatusLiteral = Literal["ingested", "preprocessed", "qc_failed"]


class StreamMetadataContract(BaseModel):
    protocol: Literal["rtsp", "http_push", "file_upload"] = "http_push"
    fps: float | None = Field(default=None, gt=0, le=60)
    width: int | None = Field(default=None, ge=1)
    height: int | None = Field(default=None, ge=1)
    pixel_format: str | None = Field(default=None, max_length=64)
    thermal_palette: str | None = Field(default=None, max_length=64)
    temp_min_c: float | None = None
    temp_max_c: float | None = None
    codec: str | None = Field(default=None, max_length=32)


class CameraLocationContract(BaseModel):
    latitude: LatitudeFloat
    longitude: LongitudeFloat


class CameraZoneContract(BaseModel):
    zone_id: str | None = Field(default=None, max_length=64)
    zone_name: NonEmptyStr = Field(max_length=160)
    zone_type: Literal["crop_field", "structure", "perimeter_boundary"] = "crop_field"


class HttpFrameIngestionMetadata(BaseModel):
    camera_id: NonEmptyStr = Field(max_length=64)
    timestamp: datetime
    location: CameraLocationContract | None = None
    zone: CameraZoneContract | None = None
    stream_metadata: StreamMetadataContract | None = None
    sequence_number: int = Field(default=0, ge=0)


class ThermalFrameResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    camera_id: uuid.UUID | None = None
    camera_code: str | None = None
    camera_name: str | None = None
    zone_name: str | None = None
    capture_mode: str
    source_filename: str | None = None
    captured_at: datetime
    frame_index: int
    width: int
    height: int
    pixel_format: str
    qc_passed: bool
    qc_metrics: dict[str, Any]
    rejection_reason: str | None = None
    raw_object_key: str
    processed_object_key: str | None = None
    processing_status: str
    is_dev_test: bool
    created_at: datetime
    updated_at: datetime


class DevSampleIngestResponse(BaseModel):
    mode: Literal["DEVELOPMENT_TEST_MODE"] = "DEVELOPMENT_TEST_MODE"
    notice: str = (
        "Frames processed via Stage 1 CV QC & preprocessing only. "
        "No wildlife AI detection (Stage 3) is active in Phase 1."
    )
    camera_id: uuid.UUID
    camera_code: str
    storage_backend: str
    media_type: Literal["image", "video"]
    extracted_count: int
    accepted_count: int
    rejected_count: int
    video_summary: dict[str, Any] | None = None
    frames: list[ThermalFrameResponse]


class RtspTestPullRequest(BaseModel):
    camera_id: uuid.UUID | None = None
    rtsp_url: NonEmptyStr = Field(max_length=512)
    max_frames: int = Field(default=5, ge=1, le=10)
    timeout_seconds: float = Field(default=8.0, ge=1.0, le=20.0)


class RtspTestPullResponse(BaseModel):
    reachable: bool
    masked_rtsp_url: str
    frames_retrieved: int
    accepted_count: int
    rejected_count: int
    frames: list[ThermalFrameResponse]
