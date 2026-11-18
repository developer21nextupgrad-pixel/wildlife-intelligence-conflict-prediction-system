from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import (
    HumanInjuryLiteral,
    IncidentStatusLiteral,
    IncidentTypeLiteral,
    LatitudeFloat,
    LongitudeFloat,
    NonEmptyStr,
    SeverityLiteral,
    SpeciesLiteral,
)


class IncidentCreate(BaseModel):
    incident_code: str | None = Field(default=None, max_length=64)
    species: SpeciesLiteral
    date_time: datetime
    latitude: LatitudeFloat
    longitude: LongitudeFloat
    village_id: UUID | None = None
    village: NonEmptyStr = Field(..., max_length=160)
    district: NonEmptyStr = Field(default="Bandipur Division", max_length=120)
    forest_range: NonEmptyStr = Field(..., max_length=120)
    incident_type: IncidentTypeLiteral
    severity: SeverityLiteral
    human_injury: HumanInjuryLiteral = "None"
    human_injuries_count: int = Field(default=0, ge=0, le=1000)
    livestock_loss_count: int = Field(default=0, ge=0, le=10000)
    crop_damage_estimated_acres: float = Field(default=0.0, ge=0.0, le=100000.0)
    crop_type: str | None = Field(default=None, max_length=160)
    description: NonEmptyStr = Field(..., max_length=5000)
    image_url: str | None = Field(default=None, max_length=512)
    status: IncidentStatusLiteral = "Reported"
    reported_by: NonEmptyStr = Field(..., max_length=160)
    assigned_officer: str | None = Field(default=None, max_length=160)
    action_taken: str | None = Field(default=None, max_length=2000)


class IncidentUpdate(BaseModel):
    species: SpeciesLiteral | None = None
    date_time: datetime | None = None
    latitude: LatitudeFloat | None = None
    longitude: LongitudeFloat | None = None
    village_id: UUID | None = None
    village: NonEmptyStr | None = Field(default=None, max_length=160)
    district: NonEmptyStr | None = Field(default=None, max_length=120)
    forest_range: NonEmptyStr | None = Field(default=None, max_length=120)
    incident_type: IncidentTypeLiteral | None = None
    severity: SeverityLiteral | None = None
    human_injury: HumanInjuryLiteral | None = None
    human_injuries_count: int | None = Field(default=None, ge=0, le=1000)
    livestock_loss_count: int | None = Field(default=None, ge=0, le=10000)
    crop_damage_estimated_acres: float | None = Field(default=None, ge=0.0, le=100000.0)
    crop_type: str | None = Field(default=None, max_length=160)
    description: NonEmptyStr | None = Field(default=None, max_length=5000)
    image_url: str | None = Field(default=None, max_length=512)
    status: IncidentStatusLiteral | None = None
    reported_by: NonEmptyStr | None = Field(default=None, max_length=160)
    assigned_officer: str | None = Field(default=None, max_length=160)
    action_taken: str | None = Field(default=None, max_length=2000)


class IncidentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    incident_code: str
    species: str
    date_time: datetime
    latitude: float
    longitude: float
    village_id: UUID | None = None
    village: str
    district: str
    forest_range: str
    incident_type: str
    severity: str
    human_injury: str
    human_injuries_count: int
    livestock_loss_count: int
    crop_damage_estimated_acres: float
    crop_type: str | None = None
    description: str
    image_url: str | None = None
    status: str
    reported_by: str
    assigned_officer: str | None = None
    action_taken: str | None = None
    is_demo: bool
    created_at: datetime
    updated_at: datetime
