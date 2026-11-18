import uuid

from sqlalchemy import JSON, CheckConstraint, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import GUID, DemoFlagMixin, PortableGeometry, TimestampMixin


class RiskZone(TimestampMixin, DemoFlagMixin, Base):
    __tablename__ = "risk_zones"
    __table_args__ = (
        CheckConstraint("center_lat >= -90.0 AND center_lat <= 90.0", name="ck_risk_zones_lat"),
        CheckConstraint("center_lng >= -180.0 AND center_lng <= 180.0", name="ck_risk_zones_lng"),
        CheckConstraint("risk_score >= 0 AND risk_score <= 100", name="ck_risk_zones_score"),
        CheckConstraint("active_alert_count >= 0", name="ck_risk_zones_alert_count"),
        Index("ix_risk_zones_district_level", "district", "risk_level"),
        Index("ix_risk_zones_geom", "geom", postgresql_using="gist"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    district: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    forest_range: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    village_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("villages.id", ondelete="SET NULL"), nullable=True, index=True
    )
    risk_level: Mapped[str] = mapped_column(String(32), nullable=False)
    risk_score: Mapped[int] = mapped_column(Integer, nullable=False, default=50)
    dominant_species: Mapped[str] = mapped_column(String(64), nullable=False)
    center_lat: Mapped[float] = mapped_column(Float, nullable=False)
    center_lng: Mapped[float] = mapped_column(Float, nullable=False)
    polygon_coordinates: Mapped[list[list[float]]] = mapped_column(JSON, nullable=False)
    geom: Mapped[object] = mapped_column(
        PortableGeometry(geometry_type="POLYGON", srid=4326),
        nullable=False,
    )
    active_alert_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    primary_risk_factor: Mapped[str] = mapped_column(Text, nullable=False)
