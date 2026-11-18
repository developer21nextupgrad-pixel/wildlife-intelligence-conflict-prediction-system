from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import (
    LatitudeFloat,
    LongitudeFloat,
    NonEmptyStr,
    PatrolPriorityLiteral,
    PatrolStatusLiteral,
)


class PatrolCreate(BaseModel):
    patrol_code: str | None = Field(default=None, max_length=64)
    team_name: NonEmptyStr = Field(..., max_length=200)
    lead_officer: NonEmptyStr = Field(..., max_length=160)
    target_area: NonEmptyStr = Field(..., max_length=240)
    sector: NonEmptyStr = Field(..., max_length=160)
    district: NonEmptyStr = Field(default="Bandipur Division", max_length=120)
    village_id: UUID | None = None
    priority: PatrolPriorityLiteral = "Medium"
    status: PatrolStatusLiteral = "Scheduled"
    scheduled_window: NonEmptyStr = Field(..., max_length=120)
    active_personnel: int = Field(default=4, ge=1, le=200)
    equipment: list[str] = Field(default_factory=list)
    risk_rationale: NonEmptyStr = Field(..., max_length=3000)
    approved_by: NonEmptyStr = Field(..., max_length=160)
    latitude: LatitudeFloat
    longitude: LongitudeFloat


class PatrolUpdate(BaseModel):
    team_name: NonEmptyStr | None = Field(default=None, max_length=200)
    lead_officer: NonEmptyStr | None = Field(default=None, max_length=160)
    target_area: NonEmptyStr | None = Field(default=None, max_length=240)
    sector: NonEmptyStr | None = Field(default=None, max_length=160)
    district: NonEmptyStr | None = Field(default=None, max_length=120)
    village_id: UUID | None = None
    priority: PatrolPriorityLiteral | None = None
    status: PatrolStatusLiteral | None = None
    scheduled_window: NonEmptyStr | None = Field(default=None, max_length=120)
    active_personnel: int | None = Field(default=None, ge=1, le=200)
    equipment: list[str] | None = None
    risk_rationale: NonEmptyStr | None = Field(default=None, max_length=3000)
    approved_by: NonEmptyStr | None = Field(default=None, max_length=160)
    latitude: LatitudeFloat | None = None
    longitude: LongitudeFloat | None = None


class PatrolResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    patrol_code: str
    team_name: str
    lead_officer: str
    target_area: str
    sector: str
    district: str
    village_id: UUID | None = None
    priority: str
    status: str
    scheduled_window: str
    active_personnel: int
    equipment: list[str]
    risk_rationale: str
    approved_by: str
    latitude: float
    longitude: float
    is_demo: bool
    created_at: datetime
    updated_at: datetime
