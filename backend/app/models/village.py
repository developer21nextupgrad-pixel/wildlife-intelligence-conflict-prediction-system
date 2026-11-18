import uuid

from sqlalchemy import Boolean, CheckConstraint, Float, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import GUID, DemoFlagMixin, PortableGeometry, TimestampMixin


class Village(TimestampMixin, DemoFlagMixin, Base):
    __tablename__ = "villages"
    __table_args__ = (
        CheckConstraint("latitude >= -90.0 AND latitude <= 90.0", name="ck_villages_latitude"),
        CheckConstraint("longitude >= -180.0 AND longitude <= 180.0", name="ck_villages_longitude"),
        CheckConstraint("population >= 0", name="ck_villages_population"),
        CheckConstraint("households >= 0", name="ck_villages_households"),
        CheckConstraint("forest_distance_km >= 0", name="ck_villages_forest_distance"),
        CheckConstraint("risk_score >= 0 AND risk_score <= 100", name="ck_villages_risk_score"),
        CheckConstraint("recent_incidents_30d >= 0", name="ck_villages_recent_incidents"),
        Index("ix_villages_district_risk", "district", "risk_level"),
        Index("ix_villages_geom", "geom", postgresql_using="gist"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(160), nullable=False, unique=True, index=True)
    district: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    forest_range: Mapped[str] = mapped_column(String(120), nullable=False, default="Bandipur Range")
    population: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    households: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    forest_distance_km: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    geom: Mapped[object] = mapped_column(
        PortableGeometry(geometry_type="POINT", srid=4326),
        nullable=False,
    )
    risk_level: Mapped[str] = mapped_column(String(32), nullable=False, default="Moderate")
    risk_score: Mapped[int] = mapped_column(Integer, nullable=False, default=50)
    active_solar_fence: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    fence_status: Mapped[str] = mapped_column(String(64), nullable=False, default="Operational")
    assigned_rrt: Mapped[str] = mapped_column(String(160), nullable=False)
    emergency_contact: Mapped[str] = mapped_column(String(120), nullable=False)
    recent_incidents_30d: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
