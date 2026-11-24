from datetime import datetime
import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import GUID, DemoFlagMixin, PortableGeometry, TimestampMixin


class Sighting(TimestampMixin, DemoFlagMixin, Base):
    __tablename__ = "sightings"
    __table_args__ = (
        CheckConstraint("latitude >= -90.0 AND latitude <= 90.0", name="ck_sightings_latitude"),
        CheckConstraint("longitude >= -180.0 AND longitude <= 180.0", name="ck_sightings_longitude"),
        CheckConstraint("herd_size >= 1", name="ck_sightings_herd_size"),
        CheckConstraint(
            "bearing_degrees >= 0 AND bearing_degrees <= 360", name="ck_sightings_bearing"
        ),
        Index("ix_sightings_district_ts", "district", "timestamp"),
        Index("ix_sightings_species", "species"),
        Index("ix_sightings_geom", "geom", postgresql_using="gist"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    sighting_code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    species: Mapped[str] = mapped_column(String(64), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    geom: Mapped[object] = mapped_column(
        PortableGeometry(geometry_type="POINT", srid=4326),
        nullable=False,
    )
    location_name: Mapped[str] = mapped_column(String(200), nullable=False)
    district: Mapped[str] = mapped_column(String(120), nullable=False, default="Bandipur Division")
    forest_range: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    herd_size: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    movement_direction: Mapped[str] = mapped_column(String(32), nullable=False, default="Stationary")
    bearing_degrees: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    behavior: Mapped[str] = mapped_column(String(64), nullable=False, default="Foraging")
    juveniles_present: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    observation_details: Mapped[str] = mapped_column(Text, nullable=False)
    observer_name: Mapped[str] = mapped_column(String(160), nullable=False)
    observer_role: Mapped[str] = mapped_column(String(120), nullable=False)
    verified_by_forest_guard: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    photo_url: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # Phase 2/3 additive intelligence links
    animal_detection_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("animal_detections.id", ondelete="SET NULL", use_alter=True),
        nullable=True,
        index=True,
    )
    animal_identity_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("animal_identities.id", ondelete="SET NULL", use_alter=True),
        nullable=True,
        index=True,
    )
    camera_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("cameras.id", ondelete="SET NULL"), nullable=True, index=True
    )
    village_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("villages.id", ondelete="SET NULL"), nullable=True, index=True
    )
    external_ref_key: Mapped[str | None] = mapped_column(
        String(160), nullable=True, unique=True, index=True
    )

