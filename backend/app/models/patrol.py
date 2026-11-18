import uuid

from sqlalchemy import JSON, CheckConstraint, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import GUID, DemoFlagMixin, PortableGeometry, TimestampMixin


class Patrol(TimestampMixin, DemoFlagMixin, Base):
    __tablename__ = "patrols"
    __table_args__ = (
        CheckConstraint("latitude >= -90.0 AND latitude <= 90.0", name="ck_patrols_latitude"),
        CheckConstraint("longitude >= -180.0 AND longitude <= 180.0", name="ck_patrols_longitude"),
        CheckConstraint("active_personnel >= 1", name="ck_patrols_personnel"),
        Index("ix_patrols_district_status", "district", "status"),
        Index("ix_patrols_priority", "priority"),
        Index("ix_patrols_geom", "geom", postgresql_using="gist"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    patrol_code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    team_name: Mapped[str] = mapped_column(String(200), nullable=False)
    lead_officer: Mapped[str] = mapped_column(String(160), nullable=False)
    target_area: Mapped[str] = mapped_column(String(240), nullable=False)
    sector: Mapped[str] = mapped_column(String(160), nullable=False)
    district: Mapped[str] = mapped_column(String(120), nullable=False, default="Bandipur Division")
    village_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("villages.id", ondelete="SET NULL"), nullable=True, index=True
    )
    priority: Mapped[str] = mapped_column(String(32), nullable=False, default="Medium")
    status: Mapped[str] = mapped_column(String(48), nullable=False, default="Scheduled")
    scheduled_window: Mapped[str] = mapped_column(String(120), nullable=False)
    active_personnel: Mapped[int] = mapped_column(Integer, nullable=False, default=4)
    equipment: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    risk_rationale: Mapped[str] = mapped_column(Text, nullable=False)
    approved_by: Mapped[str] = mapped_column(String(160), nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    geom: Mapped[object] = mapped_column(
        PortableGeometry(geometry_type="POINT", srid=4326),
        nullable=False,
    )
