from datetime import datetime
import uuid

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import GUID, DemoFlagMixin, PortableGeometry, TimestampMixin


class TelemetryRecord(TimestampMixin, DemoFlagMixin, Base):
    """
    Schema foundation only for wildlife radio-collar telemetry pings.
    Sensitive GPS coordinates must NOT be exposed on unauthenticated public endpoints.
    """

    __tablename__ = "telemetry_records"
    __table_args__ = (
        CheckConstraint("latitude >= -90.0 AND latitude <= 90.0", name="ck_telemetry_latitude"),
        CheckConstraint("longitude >= -180.0 AND longitude <= 180.0", name="ck_telemetry_longitude"),
        CheckConstraint("collar_battery >= 0 AND collar_battery <= 100", name="ck_telemetry_battery"),
        CheckConstraint("speed_kmh >= 0", name="ck_telemetry_speed"),
        Index("ix_telemetry_animal_recorded", "animal_id", "recorded_at"),
        Index("ix_telemetry_geom", "geom", postgresql_using="gist"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    animal_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    animal_name: Mapped[str] = mapped_column(String(160), nullable=False)
    species: Mapped[str] = mapped_column(String(64), nullable=False)
    collar_battery: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    geom: Mapped[object] = mapped_column(
        PortableGeometry(geometry_type="POINT", srid=4326),
        nullable=False,
    )
    speed_kmh: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    direction: Mapped[str] = mapped_column(String(120), nullable=False, default="Stationary")
    status: Mapped[str] = mapped_column(String(64), nullable=False, default="In Forest Core")
    is_sensitive: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
