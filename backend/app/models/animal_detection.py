from datetime import datetime
from typing import Any
import uuid

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import GUID, TimestampMixin


class AnimalDetection(TimestampMixin, Base):
    __tablename__ = "animal_detections"
    __table_args__ = (
        CheckConstraint("file_size_bytes >= 0", name="ck_animal_detections_file_size"),
        CheckConstraint("width >= 0", name="ck_animal_detections_width"),
        CheckConstraint("height >= 0", name="ck_animal_detections_height"),
        CheckConstraint("detection_count >= 0", name="ck_animal_detections_det_count"),
        CheckConstraint("animal_count >= 0", name="ck_animal_detections_animal_count"),
        CheckConstraint("inference_duration_ms >= 0", name="ck_animal_detections_duration"),
        Index("ix_animal_detections_created_at", "created_at"),
        Index("ix_animal_detections_status", "processing_status"),
        Index("ix_animal_detections_primary_species", "primary_species"),
        Index("ix_animal_detections_camera_id", "camera_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    source_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(64), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    width: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    height: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    image_object_key: Mapped[str] = mapped_column(String(512), nullable=False)

    processing_status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="completed"
    )
    detection_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    animal_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    primary_species: Mapped[str | None] = mapped_column(String(160), nullable=True)
    primary_common_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    primary_scientific_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    primary_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)

    country_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    admin1_region: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Phase 3 camera / village / location association & idempotency
    camera_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("cameras.id", ondelete="SET NULL"), nullable=True
    )
    village_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("villages.id", ondelete="SET NULL"), nullable=True
    )
    captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    location_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(
        String(128), nullable=True, unique=True, index=True
    )
    generated_sighting_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("sightings.id", ondelete="SET NULL"), nullable=True
    )
    generated_alert_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)

    detector_model: Mapped[str] = mapped_column(String(160), nullable=False)
    classifier_model: Mapped[str] = mapped_column(String(160), nullable=False)
    inference_duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    detections: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON, nullable=False, default=list
    )
    error_message: Mapped[str | None] = mapped_column(String(512), nullable=True)

