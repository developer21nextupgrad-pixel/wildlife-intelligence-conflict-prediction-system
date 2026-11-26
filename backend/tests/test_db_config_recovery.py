"""Regression tests for .env loading, DATABASE_URL normalization, Alembic parity, and DB health checks."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import text

from app.core.config import BACKEND_ENV_FILE, ROOT_ENV_FILE, Settings
from app.core.database import (
    check_database_health,
    normalize_database_url,
    redact_database_url,
)


def test_normalize_database_url_handles_drivers_and_quotes() -> None:
    assert (
        normalize_database_url('"postgresql://wicps_user:secret%401@localhost:5432/wicps"')
        == "postgresql+psycopg://wicps_user:secret%401@localhost:5432/wicps"
    )
    assert (
        normalize_database_url("'postgres://wicps_user:pw@localhost:5433/wicps'")
        == "postgresql+psycopg://wicps_user:pw@localhost:5433/wicps"
    )
    assert (
        normalize_database_url("postgresql+psycopg2://wicps_user:pw@127.0.0.1:5432/wicps")
        == "postgresql+psycopg://wicps_user:pw@127.0.0.1:5432/wicps"
    )
    assert (
        normalize_database_url("postgresql+psycopg://wicps_user:pw@localhost:5432/wicps")
        == "postgresql+psycopg://wicps_user:pw@localhost:5432/wicps"
    )


def test_redact_database_url_never_exposes_password() -> None:
    raw = "postgresql+psycopg://wicps_user:SuperSecretPass99!@localhost:5432/wicps"
    redacted = redact_database_url(raw)
    assert "SuperSecretPass99!" not in redacted
    assert "wicps_user" in redacted
    assert "localhost:5432/wicps" in redacted


def test_settings_ignores_blank_env_placeholders_from_env_example(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            [
                "API_V1_PREFIX=",
                "AUTH_ENABLED=",
                "AUTH_JWT_EXPIRE_MINUTES=",
                "DATABASE_URL=",
                "RATE_LIMIT_REQUESTS=",
                "MAX_IMAGE_UPLOAD_MB=",
                "SMTP_PORT=",
                "SMTP_FROM_EMAIL=developer21.nextupgrad@gmail.com",
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("AUTH_ENABLED", raising=False)
    monkeypatch.delenv("RATE_LIMIT_REQUESTS", raising=False)

    settings = Settings(_env_file=str(env_file))
    assert settings.api_v1_prefix == "/api/v1"
    assert settings.auth_enabled is True
    assert settings.auth_jwt_expire_minutes == 480
    assert settings.rate_limit_requests == 120
    assert settings.database_url == "postgresql+psycopg://wicps_user:wicps_dev_password@localhost:5432/wicps"
    assert settings.smtp_from_email == "developer21.nextupgrad@gmail.com"


def test_settings_loads_root_and_backend_env_files_with_expected_precedence(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root_env = tmp_path / "root.env"
    backend_env = tmp_path / "backend.env"
    root_env.write_text(
        "DATABASE_URL=postgresql://root_user:pw1@localhost:5432/wicps_root\n"
        "APP_NAME=WICPS Root\n",
        encoding="utf-8",
    )
    backend_env.write_text(
        "DATABASE_URL=postgresql+psycopg2://wicps_user:pw2@localhost:5433/wicps\n",
        encoding="utf-8",
    )

    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("APP_NAME", raising=False)

    # backend/.env overrides root/.env while preserving root-only settings
    s = Settings(_env_file=(str(root_env), str(backend_env)))
    assert s.database_url == "postgresql+psycopg://wicps_user:pw2@localhost:5433/wicps"
    assert s.app_name == "WICPS Root"

    # Explicit OS environment variable overrides both .env files
    monkeypatch.setenv("DATABASE_URL", "postgresql://env_user:pw3@localhost:5434/wicps_env")
    s_env = Settings(_env_file=(str(root_env), str(backend_env)))
    assert s_env.database_url == "postgresql+psycopg://env_user:pw3@localhost:5434/wicps_env"


def test_settings_config_uses_absolute_root_and_backend_env_paths() -> None:
    env_files = Settings.model_config.get("env_file")
    assert isinstance(env_files, tuple)
    assert str(ROOT_ENV_FILE) in env_files
    assert str(BACKEND_ENV_FILE) in env_files
    assert Path(env_files[0]).is_absolute()
    assert Path(env_files[1]).is_absolute()


def test_alembic_resolves_same_database_url_as_fastapi(monkeypatch: pytest.MonkeyPatch) -> None:
    from alembic import command as alembic_command
    from alembic.config import Config as AlembicConfig

    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql+psycopg2://wicps_user:pw%40123@localhost:5433/wicps",
    )
    expected = Settings().database_url
    assert expected == "postgresql+psycopg://wicps_user:pw%40123@localhost:5433/wicps"

    backend_dir = Path(__file__).resolve().parents[1]
    cfg = AlembicConfig(str(backend_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_dir / "alembic"))
    # Offline SQL check verifies Alembic parses the normalized URL without touching any live DB
    alembic_command.upgrade(cfg, "0006_security_reid_idemp:head", sql=True)


def test_check_database_health_handles_postgres_without_postgis() -> None:
    class _NestedCtx:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_val, exc_tb):
            return False

    class _FakePostgresSession:
        def execute(self, stmt):
            sql = str(stmt)
            if "PostGIS_Version" in sql:
                raise RuntimeError('function postgis_version() does not exist')
            return SimpleNamespace(scalar=lambda: 1)

        def get_bind(self):
            return SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))

        def begin_nested(self):
            return _NestedCtx()

    result = check_database_health(_FakePostgresSession())  # type: ignore[arg-type]
    assert result["connected"] is True
    assert result["dialect"] == "postgresql"
    assert result["postgis_enabled"] is False
    assert result["postgis_version"] is None
