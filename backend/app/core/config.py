from functools import lru_cache
from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _clean_optional_str(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if len(cleaned) >= 2 and cleaned[0] == cleaned[-1] and cleaned[0] in {"'", '"'}:
        cleaned = cleaned[1:-1].strip()
    return cleaned or None


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
    cors_origin_regex: str = (
        r"^https://(ais-[a-z0-9-]+\.[a-z0-9.-]+\.run\.app"
        r"|[a-z0-9-]+\.scf\.usercontent\.goog"
        r"|[a-z0-9-]+\.vercel\.app)$"
    )

    rate_limit_requests: int = 120
    rate_limit_window_seconds: int = 60

    auto_seed_demo_data: bool = False
    # Security safeguard: never expose sensitive animal telemetry GPS coordinates publicly.
    expose_telemetry_coords: bool = False

    # Phase 1: Object storage & thermal ingestion settings
    storage_backend: str = "filesystem"  # "filesystem" | "s3"
    local_storage_dir: str = "./storage_dev"
    s3_endpoint_url: str | None = None
    s3_bucket: str | None = None
    s3_region: str = "us-east-1"
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None
    s3_use_ssl: bool = True

    max_image_upload_mb: int = 25
    max_video_upload_mb: int = 100
    default_extract_fps: float = 5.0
    max_video_duration_seconds: float = 30.0
    max_video_frames: int = 150
    rtsp_test_timeout_seconds: float = 8.0
    rtsp_test_max_frames: int = 5

    @field_validator(
        "s3_endpoint_url",
        "s3_bucket",
        "s3_access_key_id",
        "s3_secret_access_key",
        mode="before",
    )
    @classmethod
    def normalize_optional_s3_strings(cls, value: str | None) -> str | None:
        return _clean_optional_str(value)

    @field_validator("s3_region", mode="before")
    @classmethod
    def normalize_s3_region(cls, value: str | None) -> str:
        return _clean_optional_str(value) or ""

    @model_validator(mode="after")
    def apply_s3_provider_defaults(self) -> "Settings":
        if self.s3_endpoint_url:
            self.s3_endpoint_url = self.s3_endpoint_url.rstrip("/") or None
        endpoint = (self.s3_endpoint_url or "").lower()
        is_tigris_or_r2 = any(
            domain in endpoint
            for domain in ("storage.dev", "tigris.dev", "r2.cloudflarestorage.com")
        )
        if not self.s3_region:
            self.s3_region = "auto" if is_tigris_or_r2 else "us-east-1"
        elif is_tigris_or_r2 and "s3_region" not in self.model_fields_set:
            self.s3_region = "auto"
        return self

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

    @field_validator("default_extract_fps")
    @classmethod
    def validate_default_extract_fps(cls, value: float) -> float:
        if value <= 0 or value > 30:
            raise ValueError("default_extract_fps must be > 0 and <= 30")
        return value

    @property
    def cors_origins_list(self) -> list[str]:
        origins = [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]
        return origins or ["http://localhost:3000"]

    def validate_production_requirements(self) -> None:
        if self.environment.strip().lower() != "production":
            return

        db_url = (self.database_url or "").strip().lower()
        if (
            not db_url
            or db_url.startswith("sqlite")
            or "@localhost:5432" in db_url
            or "@127.0.0.1:5432" in db_url
        ):
            raise RuntimeError(
                "Production configuration error: DATABASE_URL must point to a managed PostgreSQL/PostGIS database (Neon/RDS). SQLite and localhost defaults are disallowed."
            )

        if (self.storage_backend or "").strip().lower() != "s3" or not (self.s3_bucket or "").strip():
            raise RuntimeError(
                "Production configuration error: STORAGE_BACKEND=s3 and S3_BUCKET are required in production. Local filesystem storage is disallowed."
            )

        if bool(self.s3_access_key_id) != bool(self.s3_secret_access_key):
            raise RuntimeError(
                "Production configuration error: S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must both be configured together."
            )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
