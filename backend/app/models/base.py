from datetime import datetime, timezone
import uuid

from geoalchemy2 import Geometry
from sqlalchemy import Boolean, DateTime, Text, func, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import CHAR, TypeDecorator


class PortableGeometry(TypeDecorator):
    """Native PostGIS Geometry on PostgreSQL; WKT Text on SQLite test engines."""

    impl = Text
    cache_ok = True

    def __init__(self, geometry_type: str, srid: int = 4326) -> None:
        super().__init__()
        self.geometry_type = geometry_type
        self.srid = srid

    def load_dialect_impl(self, dialect):
        if dialect is not None and dialect.name == "postgresql":
            return dialect.type_descriptor(
                Geometry(
                    geometry_type=self.geometry_type,
                    srid=self.srid,
                    spatial_index=False,
                )
            )
        return dialect.type_descriptor(Text())


class GUID(TypeDecorator):
    """Platform-independent UUID type: uses native PostgreSQL UUID, CHAR(36) elsewhere."""

    impl = CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PG_UUID(as_uuid=True))
        return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if dialect.name == "postgresql":
            return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))
        return str(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
        server_default=func.now(),
    )


class DemoFlagMixin:
    is_demo: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
        index=True,
    )
