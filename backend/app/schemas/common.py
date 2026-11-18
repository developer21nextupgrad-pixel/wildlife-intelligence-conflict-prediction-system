from datetime import datetime
import math
from typing import Annotated, Any, Generic, Literal, TypeVar

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator

T = TypeVar("T")

SpeciesLiteral = Literal[
    "Asian Elephant",
    "Bengal Tiger",
    "Indian Leopard",
    "Sloth Bear",
    "Wild Boar",
    "Gaur",
]

SeverityLiteral = Literal["Low", "Moderate", "High", "Critical"]

IncidentStatusLiteral = Literal[
    "Reported",
    "Verified",
    "Patrol Dispatched",
    "Under Control",
    "Resolved",
    "Closed",
]

IncidentTypeLiteral = Literal[
    "Crop Depredation",
    "Human Injury / Attack",
    "Livestock Predation",
    "Property / House Damage",
    "Village Incursion",
    "Infrastructure Breach",
]

HumanInjuryLiteral = Literal["None", "Minor", "Severe", "Fatal"]

MovementDirectionLiteral = Literal[
    "North",
    "North-East",
    "East",
    "South-East",
    "South",
    "South-West",
    "West",
    "North-West",
    "Stationary",
]

SightingBehaviorLiteral = Literal[
    "Foraging",
    "Moving towards village",
    "Near waterhole",
    "Aggressive / Agitated",
    "Resting",
]

FenceStatusLiteral = Literal["Operational", "Breached", "Maintenance Required"]

AlertResponseStatusLiteral = Literal[
    "Pending Dispatch",
    "RRT En Route",
    "On Scene",
    "Area Cleared",
    "False Alarm",
]

PatrolPriorityLiteral = Literal["Critical", "High", "Medium", "Low"]

PatrolStatusLiteral = Literal[
    "In Progress",
    "On Station",
    "Scheduled",
    "Completed",
    "Standby",
]


def _check_non_empty_str(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ValueError("Field cannot be empty or whitespace-only.")
    return cleaned


def _check_finite_lat(value: float) -> float:
    if not math.isfinite(value) or value < -90.0 or value > 90.0:
        raise ValueError("Latitude must be a finite number between -90 and 90.")
    return value


def _check_finite_lng(value: float) -> float:
    if not math.isfinite(value) or value < -180.0 or value > 180.0:
        raise ValueError("Longitude must be a finite number between -180 and 180.")
    return value


NonEmptyStr = Annotated[str, AfterValidator(_check_non_empty_str)]
LatitudeFloat = Annotated[float, AfterValidator(_check_finite_lat)]
LongitudeFloat = Annotated[float, AfterValidator(_check_finite_lng)]


class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    environment: str
    timestamp: datetime
    telemetry_coords_exposed: bool = False


class DatabaseHealthResponse(BaseModel):
    status: str
    connected: bool
    dialect: str
    postgis_enabled: bool
    postgis_version: str | None = None
    counts: dict[str, int]


class GeoJSONGeometry(BaseModel):
    type: Literal["Point", "Polygon"]
    coordinates: list[Any]


class GeoJSONFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    id: str
    geometry: GeoJSONGeometry
    properties: dict[str, Any]


class GeoJSONFeatureCollection(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    type: Literal["FeatureCollection"] = "FeatureCollection"
    crs: str = "EPSG:4326"
    count: int
    features: list[GeoJSONFeature]

    @field_validator("count")
    @classmethod
    def validate_count(cls, value: int) -> int:
        return max(0, value)
