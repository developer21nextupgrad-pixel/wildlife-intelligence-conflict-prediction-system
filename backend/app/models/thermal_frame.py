from datetime import datetime
from typing import Any
import uuid

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import GUID, TimestampMixin


class ThermalFrame(TimestampMixin, Base):
    __tablename__ = "thermal_frames"
    __table_args__ = (
        CheckConstraint("frame_index >= 0", name="ck_thermal_frames_index"),
        CheckConstraint("width >= 0", name="ck_thermal_frames_width"),
        CheckConstraint("height >= 0", name="ck_thermal_frames_height"),
        Index("ix_thermal_frames_camera_captured", "camera_id", "captured_at"),
        Index("ix_thermal_frames_qc_status", "qc_passed", "processing_status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    camera_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False, index=True
    )
    capture_mode: Mapped[str] = mapped_column(
        String(32), nullable=False, default="dev_sample_upload"
    )
    source_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    frame_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    width: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    height: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    pixel_format: Mapped[str] = mapped_column(String(48), nullable=False, default="unknown")
    qc_passed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    qc_metrics: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    rejection_reason: Mapped[str | None] = mapped_column(String(240), nullable=True)
    raw_object_key: Mapped[str] = mapped_column(String(512), nullable=False)
    processed_object_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    processing_status: Mapped[str] = mapped_column(String(32), nullable=False, default="ingested")
    is_dev_test: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
