from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import (
    LatitudeFloat,
    LongitudeFloat,
    MovementDirectionLiteral,
    NonEmptyStr,
    SightingBehaviorLiteral,
    SpeciesLiteral,
)


class SightingCreate(BaseModel):
    sighting_code: str | None = Field(default=None, max_length=64)
    species: SpeciesLiteral
    timestamp: datetime
    latitude: LatitudeFloat
    longitude: LongitudeFloat
    location_name: NonEmptyStr = Field(..., max_length=200)
    district: NonEmptyStr = Field(default="Bandipur Division", max_length=120)
    forest_range: NonEmptyStr = Field(..., max_length=120)
    herd_size: int = Field(default=1, ge=1, le=500)
    movement_direction: MovementDirectionLiteral = "Stationary"
    bearing_degrees: int | None = Field(default=None, ge=0, le=360)
    behavior: SightingBehaviorLiteral = "Foraging"
    juveniles_present: bool = False
    observation_details: NonEmptyStr = Field(..., max_length=5000)
    observer_name: NonEmptyStr = Field(..., max_length=160)
    observer_role: NonEmptyStr = Field(..., max_length=120)
    verified_by_forest_guard: bool = False
    photo_url: str | None = Field(default=None, max_length=512)


class SightingUpdate(BaseModel):
    species: SpeciesLiteral | None = None
    timestamp: datetime | None = None
    latitude: LatitudeFloat | None = None
    longitude: LongitudeFloat | None = None
    location_name: NonEmptyStr | None = Field(default=None, max_length=200)
    district: NonEmptyStr | None = Field(default=None, max_length=120)
    forest_range: NonEmptyStr | None = Field(default=None, max_length=120)
    herd_size: int | None = Field(default=None, ge=1, le=500)
    movement_direction: MovementDirectionLiteral | None = None
    bearing_degrees: int | None = Field(default=None, ge=0, le=360)
    behavior: SightingBehaviorLiteral | None = None
    juveniles_present: bool | None = None
    observation_details: NonEmptyStr | None = Field(default=None, max_length=5000)
    observer_name: NonEmptyStr | None = Field(default=None, max_length=160)
    observer_role: NonEmptyStr | None = Field(default=None, max_length=120)
    verified_by_forest_guard: bool | None = None
    photo_url: str | None = Field(default=None, max_length=512)


class SightingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    sighting_code: str
    species: str
    timestamp: datetime
    latitude: float
    longitude: float
    location_name: str
    district: str
    forest_range: str
    herd_size: int
    movement_direction: str
    bearing_degrees: int
    behavior: str
    juveniles_present: bool
    observation_details: str
    observer_name: str
    observer_role: str
    verified_by_forest_guard: bool
    photo_url: str | None = None
    is_demo: bool
    created_at: datetime
    updated_at: datetime
