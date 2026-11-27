from functools import lru_cache
from pathlib import Path
import secrets
from typing import Any
from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_DIR.parent
ROOT_ENV_FILE = PROJECT_ROOT / ".env"
BACKEND_ENV_FILE = BACKEND_DIR / ".env"


def _clean_optional_str(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if len(cleaned) >= 2 and cleaned[0] == cleaned[-1] and cleaned[0] in {"'", '"'}:
        cleaned = cleaned[1:-1].strip()
    return cleaned or None


def _normalize_db_url_string(raw_url: str) -> str:
    cleaned = _clean_optional_str(raw_url) or ""
    if cleaned.startswith("postgres://"):
        return "postgresql+psycopg://" + cleaned[len("postgres://") :]
    if cleaned.startswith("postgresql://"):
        return "postgresql+psycopg://" + cleaned[len("postgresql://") :]
    if cleaned.startswith("postgresql+psycopg2://"):
        return "postgresql+psycopg://" + cleaned[len("postgresql+psycopg2://") :]
    return cleaned


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Load project-root .env first, then backend/.env (higher precedence), regardless of CWD.
        # Explicit OS environment variables always override both .env files.
        env_file=(str(ROOT_ENV_FILE), str(BACKEND_ENV_FILE)),
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
    # Restrictive by default: explicit production/preview origins must be listed via CORS_ORIGINS.
    cors_origin_regex: str = ""

    rate_limit_requests: int = 120
    rate_limit_window_seconds: int = 60
    auth_login_rate_limit_requests: int = 15
    auth_login_rate_limit_window_seconds: int = 60
    auth_register_rate_limit_requests: int = 10
    auth_register_rate_limit_window_seconds: int = 300
    auth_password_reset_rate_limit_requests: int = 5
    auth_password_reset_rate_limit_window_seconds: int = 300
    assistant_rate_limit_requests: int = 20
    assistant_rate_limit_window_seconds: int = 60
    rate_limit_redis_url: str | None = None

    # Phase A Security: JWT / OIDC Authentication & RBAC
    auth_enabled: bool = True
    auth_jwt_secret: str | None = None
    auth_jwt_issuer: str = "wicps-api"
    auth_jwt_audience: str = "wicps-console"
    auth_jwt_expire_minutes: int = 480
    auth_oidc_issuer: str | None = None
    auth_oidc_audience: str | None = None
    auth_oidc_jwks_url: str | None = None
    auth_role_claim: str = "roles"
    auth_bootstrap_admin_email: str | None = None
    auth_bootstrap_admin_password: str | None = None
    auth_bootstrap_admin_name: str = "Division Administrator"
    auth_require_admin_approval: bool = False
    password_reset_token_expire_minutes: int = 20

    # Phase 2 Email / Gmail SMTP Password Recovery Configuration
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_username: str | None = "developer21.nextupgrad@gmail.com"
    smtp_password: str | None = None
    smtp_from_email: str = "developer21.nextupgrad@gmail.com"
    smtp_use_tls: bool = True
    smtp_timeout_seconds: int = 15
    frontend_url: str | None = None
    frontend_base_url: str = "http://localhost:3000"

    # AI Wildlife Intelligence Assistant (Server-side Gemini API)
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-4-hydrogen"
    gemini_timeout_seconds: float = 30.0
    assistant_max_history_messages: int = 12

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
    rtsp_allowed_hosts: str = ""

    # Phase 1 Animal Detection & Species Identification (MegaDetector + Google SpeciesNet)
    speciesnet_model: str = "kaggle:google/speciesnet/pyTorch/v4.0.3a/1"
    speciesnet_default_country: str | None = "IND"
    speciesnet_default_admin1_region: str | None = None
    speciesnet_geofence_enabled: bool = True
    speciesnet_min_detection_confidence: float = 0.20
    speciesnet_min_species_confidence: float = 0.50
    speciesnet_max_detections_per_image: int = 25
    speciesnet_preload_on_startup: bool = False

    # Phase 2: Individual Animal Re-Identification (BVRA MegaDescriptor + pgvector)
    megadescriptor_enabled: bool = True
    megadescriptor_model: str = "hf-hub:BVRA/MegaDescriptor-T-224"
    megadescriptor_embedding_dim: int = 768
    reid_match_threshold: float = 0.75
    reid_ambiguous_threshold: float = 0.55
    reid_margin_threshold: float = 0.04
    reid_min_crop_px: int = 48
    reid_min_blur_laplacian: float = 25.0
    megadescriptor_preload_on_startup: bool = False

    # Phase 3: Notification provider mode & IoT boundary contract settings
    notification_provider_mode: str = "stub"  # "stub" | "webhook_disabled"
    default_sighting_repeat_window_minutes: int = 120

    @model_validator(mode="before")
    @classmethod
    def drop_blank_env_placeholders(cls, data: Any) -> Any:
        """Treat blank KEY= placeholders (e.g. copied from .env.example) as unset so field defaults apply."""
        if not isinstance(data, dict):
            return data
        # Preserve explicit empty values for allowlist fields whose empty string has semantic meaning
        # (e.g. production validation must reject empty CORS_ORIGINS).
        preserve_empty_keys = {"cors_origins", "cors_origin_regex", "rtsp_allowed_hosts"}
        cleaned: dict[str, Any] = {}
        for key, value in data.items():
            if (
                isinstance(value, str)
                and not value.strip()
                and key.lower() not in preserve_empty_keys
            ):
                continue
            cleaned[key] = value
        return cleaned

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_database_url_field(cls, value: str | None) -> str:
        normalized = _normalize_db_url_string(value or "")
        return normalized or "postgresql+psycopg://wicps_user:wicps_dev_password@localhost:5432/wicps"

    @field_validator(
        "s3_endpoint_url",
        "s3_bucket",
        "s3_access_key_id",
        "s3_secret_access_key",
        "auth_jwt_secret",
        "auth_oidc_issuer",
        "auth_oidc_audience",
        "auth_oidc_jwks_url",
        "auth_bootstrap_admin_email",
        "auth_bootstrap_admin_password",
        "rate_limit_redis_url",
        "smtp_username",
        "smtp_password",
        "frontend_url",
        "gemini_api_key",
        mode="before",
    )
    @classmethod
    def normalize_optional_strings(cls, value: str | None) -> str | None:
        return _clean_optional_str(value)

    @field_validator("s3_region", mode="before")
    @classmethod
    def normalize_s3_region(cls, value: str | None) -> str:
        return _clean_optional_str(value) or ""

    @model_validator(mode="after")
    def apply_defaults(self) -> "Settings":
        if self.s3_endpoint_url:
            self.s3_endpoint_url = self.s3_endpoint_url.rstrip("/") or None
        if self.frontend_url:
            self.frontend_url = self.frontend_url.strip().rstrip("/") or None
        if self.frontend_base_url:
            self.frontend_base_url = self.frontend_base_url.strip().rstrip("/") or "http://localhost:3000"
        self.smtp_host = (_clean_optional_str(self.smtp_host) or "smtp.gmail.com")
        self.smtp_from_email = (_clean_optional_str(self.smtp_from_email) or "")
        self.gemini_model = (_clean_optional_str(self.gemini_model) or "gemini-4-hydrogen")
        endpoint = (self.s3_endpoint_url or "").lower()
        is_tigris_or_r2 = any(
            domain in endpoint
            for domain in ("storage.dev", "tigris.dev", "r2.cloudflarestorage.com")
        )
        if not self.s3_region:
            self.s3_region = "auto" if is_tigris_or_r2 else "us-east-1"
        elif is_tigris_or_r2 and "s3_region" not in self.model_fields_set:
            self.s3_region = "auto"

        # Generate an ephemeral CSPRNG signing key strictly for non-production runs when unset.
        # Production requires an explicit AUTH_JWT_SECRET (>= 32 chars) or OIDC JWKS configuration.
        if self.environment.strip().lower() != "production" and not self.auth_jwt_secret:
            self.auth_jwt_secret = secrets.token_urlsafe(48)

        return self

    @field_validator(
        "rate_limit_requests",
        "auth_login_rate_limit_requests",
        "auth_register_rate_limit_requests",
        "auth_password_reset_rate_limit_requests",
        "assistant_rate_limit_requests",
    )
    @classmethod
    def validate_rate_limit_requests(cls, value: int) -> int:
        if value < 1:
            raise ValueError("rate_limit_requests must be >= 1")
        return value

    @field_validator(
        "rate_limit_window_seconds",
        "auth_login_rate_limit_window_seconds",
        "auth_register_rate_limit_window_seconds",
        "auth_password_reset_rate_limit_window_seconds",
        "assistant_rate_limit_window_seconds",
    )
    @classmethod
    def validate_rate_limit_window(cls, value: int) -> int:
        if value < 1:
            raise ValueError("rate_limit_window_seconds must be >= 1")
        return value

    @field_validator("password_reset_token_expire_minutes")
    @classmethod
    def validate_password_reset_expiry(cls, value: int) -> int:
        if value < 15 or value > 30:
            raise ValueError("password_reset_token_expire_minutes must be between 15 and 30 minutes")
        return value

    @field_validator("smtp_port")
    @classmethod
    def validate_smtp_port(cls, value: int) -> int:
        if value < 1 or value > 65535:
            raise ValueError("smtp_port must be between 1 and 65535")
        return value

    @field_validator("default_extract_fps")
    @classmethod
    def validate_default_extract_fps(cls, value: float) -> float:
        if value <= 0 or value > 30:
            raise ValueError("default_extract_fps must be > 0 and <= 30")
        return value

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() == "production"

    @property
    def cors_origins_list(self) -> list[str]:
        origins = [origin.strip().rstrip("/") for origin in self.cors_origins.split(",") if origin.strip()]
        if origins:
            return origins
        return [] if self.is_production else ["http://localhost:3000", "http://127.0.0.1:3000"]

    @property
    def effective_frontend_url(self) -> str:
        raw = self.frontend_url or self.frontend_base_url or "http://localhost:3000"
        return raw.strip().rstrip("/") or "http://localhost:3000"

    @property
    def rtsp_allowed_hosts_set(self) -> set[str]:
        return {h.strip().lower() for h in self.rtsp_allowed_hosts.split(",") if h.strip()}

    def validate_production_requirements(self) -> None:
        if not self.is_production:
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

        if not self.auth_enabled:
            raise RuntimeError(
                "Production configuration error: AUTH_ENABLED cannot be disabled in production."
            )

        has_hs256 = bool(self.auth_jwt_secret and len(self.auth_jwt_secret) >= 32)
        has_oidc = bool(self.auth_oidc_jwks_url and self.auth_oidc_issuer)
        if not has_hs256 and not has_oidc:
            raise RuntimeError(
                "Production configuration error: configure AUTH_JWT_SECRET (min 32 chars) and/or OIDC (AUTH_OIDC_JWKS_URL + AUTH_OIDC_ISSUER)."
            )

        origins = self.cors_origins_list
        if "*" in origins:
            raise RuntimeError(
                "Production configuration error: wildcard '*' in CORS_ORIGINS is disallowed with credentials enabled."
            )
        if not origins and not (self.cors_origin_regex or "").strip():
            raise RuntimeError(
                "Production configuration error: CORS_ORIGINS must specify explicit allowed frontend origins."
            )
        if self.cors_origin_regex and ("vercel.app" in self.cors_origin_regex and "\\." in self.cors_origin_regex and "[a-z0-9-]+" in self.cors_origin_regex):
            raise RuntimeError(
                "Production configuration error: wildcard '*.vercel.app' CORS_ORIGIN_REGEX is disallowed."
            )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()

