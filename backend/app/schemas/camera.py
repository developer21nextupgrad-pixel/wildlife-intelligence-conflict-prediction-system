from datetime import datetime
from typing import Any, Literal
import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import LatitudeFloat, LongitudeFloat, NonEmptyStr

ZoneTypeLiteral = Literal["crop_field", "structure", "perimeter_boundary"]
CameraProtocolLiteral = Literal["rtsp", "http_push", "file_upload"]
CameraStatusLiteral = Literal["active", "offline", "maintenance"]


class CameraCreate(BaseModel):
    camera_code: NonEmptyStr = Field(max_length=64)
    name: NonEmptyStr = Field(max_length=160)
    village_id: uuid.UUID | None = None
    village_name: str | None = Field(default=None, max_length=160)
    zone_name: NonEmptyStr = Field(max_length=160)
    zone_type: ZoneTypeLiteral = "crop_field"
    latitude: LatitudeFloat
    longitude: LongitudeFloat
    protocol: CameraProtocolLiteral = "http_push"
    stream_metadata: dict[str, Any] = Field(default_factory=dict)
    status: CameraStatusLiteral = "active"
    is_dev_test: bool = False


class CameraUpdate(BaseModel):
    name: NonEmptyStr | None = Field(default=None, max_length=160)
    village_id: uuid.UUID | None = None
    zone_name: NonEmptyStr | None = Field(default=None, max_length=160)
    zone_type: ZoneTypeLiteral | None = None
    latitude: LatitudeFloat | None = None
    longitude: LongitudeFloat | None = None
    protocol: CameraProtocolLiteral | None = None
    stream_metadata: dict[str, Any] | None = None
    status: CameraStatusLiteral | None = None
    is_dev_test: bool | None = None


class CameraHeartbeatRequest(BaseModel):
    status: CameraStatusLiteral | None = None
    stream_metadata: dict[str, Any] | None = None


class CameraResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    camera_code: str
    name: str
    village_id: uuid.UUID | None = None
    zone_name: str
    zone_type: str
    latitude: float
    longitude: float
    protocol: str
    stream_metadata: dict[str, Any]
    status: str
    last_heartbeat_at: datetime | None = None
    is_dev_test: bool
    created_at: datetime
    updated_at: datetime


class CameraCreateResponse(CameraResponse):
    """Returned only once upon creation so caller can securely store the camera API key."""

    api_key: str
    api_key_notice: str = (
        "Store this X-Camera-Key securely. Only a salted hash is retained on the server."
    )
