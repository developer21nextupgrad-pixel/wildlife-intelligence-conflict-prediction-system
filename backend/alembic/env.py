import logging
from logging.config import fileConfig
import os

from alembic import context
from sqlalchemy import create_engine, pool

from app.core.config import Settings
from app.core.database import normalize_database_url, redact_database_url
from app.models import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

logger = logging.getLogger("alembic.env")


def resolve_migration_database_url() -> str:
    """Resolve and validate the Alembic target DATABASE_URL identically to FastAPI Settings."""
    settings = Settings()
    env_name = (os.environ.get("ENVIRONMENT") or settings.environment or "").strip().lower()
    raw_env_url = (os.environ.get("DATABASE_URL") or "").strip()

    if env_name == "production":
        if not raw_env_url:
            raise RuntimeError(
                "Production migration error: DATABASE_URL environment variable must be explicitly set."
            )
        normalized = normalize_database_url(raw_env_url)
        lowered = normalized.lower()
        if (
            lowered.startswith("sqlite")
            or "@localhost" in lowered
            or "@127.0.0.1" in lowered
        ):
            raise RuntimeError(
                "Production migration error: refusing to run Alembic against SQLite or a localhost database."
            )
        return normalized

    chosen = raw_env_url or settings.database_url or config.get_main_option("sqlalchemy.url") or ""
    return normalize_database_url(chosen)


db_url = resolve_migration_database_url()
logger.info("Alembic target database: %s", redact_database_url(db_url))
target_metadata = Base.metadata


def include_object(object_, name, type_, reflected, compare_to):
    # Ignore PostGIS internal metadata tables during autogenerate diffs
    if type_ == "table" and name in {"spatial_ref_sys", "topology", "layer"}:
        return False
    return True


def run_migrations_offline() -> None:
    context.configure(
        url=db_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_object=include_object,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(
        db_url,
        poolclass=pool.NullPool,
        future=True,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_object=include_object,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
