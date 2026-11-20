from datetime import datetime
from typing import Any
import uuid

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import GUID, PortableGeometry, TimestampMixin


class Camera(TimestampMixin, Base):
    __tablename__ = "cameras"
    __table_args__ = (
        CheckConstraint("latitude >= -90.0 AND latitude <= 90.0", name="ck_cameras_latitude"),
        CheckConstraint("longitude >= -180.0 AND longitude <= 180.0", name="ck_cameras_longitude"),
        Index("ix_cameras_zone_status", "zone_name", "status"),
        Index("ix_cameras_protocol", "protocol"),
        Index("ix_cameras_geom", "geom", postgresql_using="gist"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    camera_code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    village_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("villages.id", ondelete="SET NULL"), nullable=True, index=True
    )
    zone_name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    zone_type: Mapped[str] = mapped_column(String(48), nullable=False, default="crop_field")
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    geom: Mapped[object] = mapped_column(
        PortableGeometry(geometry_type="POINT", srid=4326),
        nullable=False,
    )
    protocol: Mapped[str] = mapped_column(String(32), nullable=False, default="http_push")
    stream_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    api_key_hash: Mapped[str] = mapped_column(String(160), nullable=False)
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    is_dev_test: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
