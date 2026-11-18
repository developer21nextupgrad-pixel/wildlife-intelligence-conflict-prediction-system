from datetime import datetime
import uuid

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import GUID, DemoFlagMixin, PortableGeometry, TimestampMixin


class Incident(TimestampMixin, DemoFlagMixin, Base):
    __tablename__ = "incidents"
    __table_args__ = (
        CheckConstraint("latitude >= -90.0 AND latitude <= 90.0", name="ck_incidents_latitude"),
        CheckConstraint("longitude >= -180.0 AND longitude <= 180.0", name="ck_incidents_longitude"),
        CheckConstraint("human_injuries_count >= 0", name="ck_incidents_human_injuries"),
        CheckConstraint("livestock_loss_count >= 0", name="ck_incidents_livestock_loss"),
        CheckConstraint("crop_damage_estimated_acres >= 0", name="ck_incidents_crop_damage"),
        Index("ix_incidents_district_dt", "district", "date_time"),
        Index("ix_incidents_status_severity", "status", "severity"),
        Index("ix_incidents_species", "species"),
        Index("ix_incidents_geom", "geom", postgresql_using="gist"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    incident_code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    species: Mapped[str] = mapped_column(String(64), nullable=False)
    date_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    geom: Mapped[object] = mapped_column(
        PortableGeometry(geometry_type="POINT", srid=4326),
        nullable=False,
    )
    village_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("villages.id", ondelete="SET NULL"), nullable=True, index=True
    )
    village: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    district: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    forest_range: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    incident_type: Mapped[str] = mapped_column(String(80), nullable=False)
    severity: Mapped[str] = mapped_column(String(32), nullable=False)
    human_injury: Mapped[str] = mapped_column(String(32), nullable=False, default="None")
    human_injuries_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    livestock_loss_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    crop_damage_estimated_acres: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    crop_type: Mapped[str | None] = mapped_column(String(160), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    status: Mapped[str] = mapped_column(String(48), nullable=False, default="Reported")
    reported_by: Mapped[str] = mapped_column(String(160), nullable=False)
    assigned_officer: Mapped[str | None] = mapped_column(String(160), nullable=True)
    action_taken: Mapped[str | None] = mapped_column(Text, nullable=True)
