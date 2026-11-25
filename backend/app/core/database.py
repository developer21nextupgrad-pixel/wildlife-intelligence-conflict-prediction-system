from collections.abc import Generator
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    """Declarative base for all WICPS SQLAlchemy 2.x models."""


def normalize_database_url(raw_url: str) -> str:
    """Normalize standard PostgreSQL URLs to the installed psycopg v3 driver."""
    url = (raw_url or "").strip()
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://") :]
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://") :]
    return url


def create_db_engine(database_url: str | None = None) -> Engine:
    settings = get_settings()
    url = normalize_database_url(database_url or settings.database_url)

    engine_kwargs: dict[str, Any] = {
        "pool_pre_ping": True,
        "future": True,
    }
    if url.startswith("sqlite"):
        engine_kwargs["connect_args"] = {"check_same_thread": False}
    else:
        engine_kwargs["pool_size"] = 5
        engine_kwargs["max_overflow"] = 10

    return create_engine(url, **engine_kwargs)


engine = create_db_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def is_postgres_backend(db: Session | Engine | None = None) -> bool:
    if isinstance(db, Session):
        bind = db.get_bind()
        return bind.dialect.name == "postgresql"
    if isinstance(db, Engine):
        return db.dialect.name == "postgresql"
    return engine.dialect.name == "postgresql"


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def check_database_health(db: Session) -> dict[str, Any]:
    db.execute(text("SELECT 1"))
    dialect = db.get_bind().dialect.name
    postgis_version: str | None = None

    if dialect == "postgresql":
        row = db.execute(text("SELECT PostGIS_Version()")).scalar()
        postgis_version = str(row) if row is not None else None

    return {
        "connected": True,
        "dialect": dialect,
        "postgis_enabled": postgis_version is not None,
        "postgis_version": postgis_version,
    }
