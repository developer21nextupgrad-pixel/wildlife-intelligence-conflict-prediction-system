from datetime import datetime
import uuid

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import GUID, DemoFlagMixin, PortableGeometry, TimestampMixin


class Alert(TimestampMixin, DemoFlagMixin, Base):
    __tablename__ = "alerts"
    __table_args__ = (
        CheckConstraint("latitude >= -90.0 AND latitude <= 90.0", name="ck_alerts_latitude"),
        CheckConstraint("longitude >= -180.0 AND longitude <= 180.0", name="ck_alerts_longitude"),
        Index("ix_alerts_district_ack", "district", "acknowledged"),
        Index("ix_alerts_severity", "severity"),
        Index("ix_alerts_geom", "geom", postgresql_using="gist"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(String(32), nullable=False)
    species: Mapped[str] = mapped_column(String(64), nullable=False)
    affected_village: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    village_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("villages.id", ondelete="SET NULL"), nullable=True, index=True
    )
    district: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    geom: Mapped[object] = mapped_column(
        PortableGeometry(geometry_type="POINT", srid=4326),
        nullable=False,
    )
    alert_time: Mapped[str] = mapped_column(String(120), nullable=False)
    triggered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    acknowledged: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    acknowledged_by: Mapped[str | None] = mapped_column(String(160), nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    assigned_officer: Mapped[str | None] = mapped_column(String(160), nullable=True)
    response_status: Mapped[str] = mapped_column(
        String(48), nullable=False, default="Pending Dispatch"
    )

    # Phase 2/3 additive intelligence links
    sighting_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("sightings.id", ondelete="SET NULL"), nullable=True, index=True
    )
    animal_identity_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("animal_identities.id", ondelete="SET NULL", use_alter=True),
        nullable=True,
        index=True,
    )
    animal_detection_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("animal_detections.id", ondelete="SET NULL"), nullable=True, index=True
    )
    alert_rule_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("alert_rules.id", ondelete="SET NULL", use_alter=True),
        nullable=True,
        index=True,
    )
    image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    risk_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    external_ref_key: Mapped[str | None] = mapped_column(
        String(160), nullable=True, unique=True, index=True
    )

