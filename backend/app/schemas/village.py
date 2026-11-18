from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import (
    FenceStatusLiteral,
    LatitudeFloat,
    LongitudeFloat,
    NonEmptyStr,
    SeverityLiteral,
)


class VillageCreate(BaseModel):
    name: NonEmptyStr = Field(..., max_length=160)
    district: NonEmptyStr = Field(default="Bandipur Division", max_length=120)
    forest_range: NonEmptyStr = Field(default="Bandipur Range", max_length=120)
    population: int = Field(default=0, ge=0, le=10000000)
    households: int = Field(default=0, ge=0, le=5000000)
    forest_distance_km: float = Field(default=0.5, ge=0.0, le=500.0)
    latitude: LatitudeFloat
    longitude: LongitudeFloat
    risk_level: SeverityLiteral = "Moderate"
    risk_score: int = Field(default=50, ge=0, le=100)
    active_solar_fence: bool = False
    fence_status: FenceStatusLiteral = "Operational"
    assigned_rrt: NonEmptyStr = Field(..., max_length=160)
    emergency_contact: NonEmptyStr = Field(..., max_length=120)
    recent_incidents_30d: int = Field(default=0, ge=0, le=10000)


class VillageUpdate(BaseModel):
    name: NonEmptyStr | None = Field(default=None, max_length=160)
    district: NonEmptyStr | None = Field(default=None, max_length=120)
    forest_range: NonEmptyStr | None = Field(default=None, max_length=120)
    population: int | None = Field(default=None, ge=0, le=10000000)
    households: int | None = Field(default=None, ge=0, le=5000000)
    forest_distance_km: float | None = Field(default=None, ge=0.0, le=500.0)
    latitude: LatitudeFloat | None = None
    longitude: LongitudeFloat | None = None
    risk_level: SeverityLiteral | None = None
    risk_score: int | None = Field(default=None, ge=0, le=100)
    active_solar_fence: bool | None = None
    fence_status: FenceStatusLiteral | None = None
    assigned_rrt: NonEmptyStr | None = Field(default=None, max_length=160)
    emergency_contact: NonEmptyStr | None = Field(default=None, max_length=120)
    recent_incidents_30d: int | None = Field(default=None, ge=0, le=10000)


class VillageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    district: str
    forest_range: str
    population: int
    households: int
    forest_distance_km: float
    latitude: float
    longitude: float
    risk_level: str
    risk_score: int
    active_solar_fence: bool
    fence_status: str
    assigned_rrt: str
    emergency_contact: str
    recent_incidents_30d: int
    is_demo: bool
    created_at: datetime
    updated_at: datetime
