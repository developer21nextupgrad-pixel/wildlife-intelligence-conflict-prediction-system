from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import (
    AlertResponseStatusLiteral,
    LatitudeFloat,
    LongitudeFloat,
    NonEmptyStr,
    SeverityLiteral,
    SpeciesLiteral,
)


class AlertCreate(BaseModel):
    title: NonEmptyStr = Field(..., max_length=240)
    message: NonEmptyStr = Field(..., max_length=5000)
    severity: SeverityLiteral
    species: SpeciesLiteral
    affected_village: NonEmptyStr = Field(..., max_length=160)
    village_id: UUID | None = None
    district: NonEmptyStr = Field(default="Bandipur Division", max_length=120)
    latitude: LatitudeFloat
    longitude: LongitudeFloat
    alert_time: str | None = Field(default=None, max_length=120)
    triggered_at: datetime | None = None
    acknowledged: bool = False
    acknowledged_by: str | None = Field(default=None, max_length=160)
    acknowledged_at: datetime | None = None
    assigned_officer: str | None = Field(default=None, max_length=160)
    response_status: AlertResponseStatusLiteral = "Pending Dispatch"


class AlertUpdate(BaseModel):
    title: NonEmptyStr | None = Field(default=None, max_length=240)
    message: NonEmptyStr | None = Field(default=None, max_length=5000)
    severity: SeverityLiteral | None = None
    species: SpeciesLiteral | None = None
    affected_village: NonEmptyStr | None = Field(default=None, max_length=160)
    village_id: UUID | None = None
    district: NonEmptyStr | None = Field(default=None, max_length=120)
    latitude: LatitudeFloat | None = None
    longitude: LongitudeFloat | None = None
    alert_time: str | None = Field(default=None, max_length=120)
    triggered_at: datetime | None = None
    acknowledged: bool | None = None
    acknowledged_by: str | None = Field(default=None, max_length=160)
    acknowledged_at: datetime | None = None
    assigned_officer: str | None = Field(default=None, max_length=160)
    response_status: AlertResponseStatusLiteral | None = None


class AlertResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    message: str
    severity: str
    species: str
    affected_village: str
    village_id: UUID | None = None
    district: str
    latitude: float
    longitude: float
    alert_time: str
    triggered_at: datetime
    acknowledged: bool
    acknowledged_by: str | None = None
    acknowledged_at: datetime | None = None
    assigned_officer: str | None = None
    response_status: str
    is_demo: bool
    created_at: datetime
    updated_at: datetime
