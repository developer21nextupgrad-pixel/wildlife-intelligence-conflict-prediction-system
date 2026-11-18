from functools import lru_cache
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    environment: str = "development"
    app_name: str = "Wildlife Intelligence & Conflict Prediction System (WICPS) API"
    app_version: str = "2.0.0"
    api_v1_prefix: str = "/api/v1"

    database_url: str = "postgresql+psycopg://wicps_user:wicps_dev_password@localhost:5432/wicps"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    cors_origin_regex: str = r"^https://(ais-[a-z0-9-]+\.[a-z0-9.-]+\.run\.app|[a-z0-9-]+\.scf\.usercontent\.goog)$"

    rate_limit_requests: int = 120
    rate_limit_window_seconds: int = 60

    auto_seed_demo_data: bool = False
    # Security safeguard: never expose sensitive animal telemetry GPS coordinates publicly.
    expose_telemetry_coords: bool = False

    @field_validator("rate_limit_requests")
    @classmethod
    def validate_rate_limit_requests(cls, value: int) -> int:
        if value < 1:
            raise ValueError("rate_limit_requests must be >= 1")
        return value

    @field_validator("rate_limit_window_seconds")
    @classmethod
    def validate_rate_limit_window(cls, value: int) -> int:
        if value < 1:
            raise ValueError("rate_limit_window_seconds must be >= 1")
        return value

    @property
    def cors_origins_list(self) -> list[str]:
        origins = [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]
        return origins or ["http://localhost:3000"]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
