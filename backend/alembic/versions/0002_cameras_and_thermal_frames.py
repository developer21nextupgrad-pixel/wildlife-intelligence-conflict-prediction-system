"""Add cameras and thermal_frames tables for Phase 1 thermal ingestion

Revision ID: 0002_cameras_and_thermal_frames
Revises: 0001_initial_schema
Create Date: 2026-11-19 00:00:00

"""
from typing import Sequence, Union

from alembic import op
import geoalchemy2
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0002_cameras_and_thermal_frames"
down_revision: Union[str, Sequence[str], None] = "0001_initial_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    uuid_type = postgresql.UUID(as_uuid=True) if is_pg else sa.CHAR(36)
    point_geom_type = (
        geoalchemy2.Geometry(geometry_type="POINT", srid=4326, spatial_index=False)
        if is_pg
        else sa.Text()
    )

    op.create_table(
        "cameras",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("camera_code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("village_id", uuid_type, nullable=True),
        sa.Column("zone_name", sa.String(length=160), nullable=False),
        sa.Column("zone_type", sa.String(length=48), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("geom", point_geom_type, nullable=False),
        sa.Column("protocol", sa.String(length=32), nullable=False),
        sa.Column("stream_metadata", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("api_key_hash", sa.String(length=160), nullable=False),
        sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_dev_test", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["village_id"], ["villages.id"], ondelete="SET NULL"),
        sa.CheckConstraint("latitude >= -90.0 AND latitude <= 90.0", name="ck_cameras_latitude"),
        sa.CheckConstraint("longitude >= -180.0 AND longitude <= 180.0", name="ck_cameras_longitude"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("camera_code"),
    )
    op.create_index("ix_cameras_camera_code", "cameras", ["camera_code"])
    op.create_index("ix_cameras_village_id", "cameras", ["village_id"])
    op.create_index("ix_cameras_zone_name", "cameras", ["zone_name"])
    op.create_index("ix_cameras_zone_status", "cameras", ["zone_name", "status"])
    op.create_index("ix_cameras_protocol", "cameras", ["protocol"])
    op.create_index("ix_cameras_last_heartbeat_at", "cameras", ["last_heartbeat_at"])
    op.create_index("ix_cameras_is_dev_test", "cameras", ["is_dev_test"])
    if is_pg:
        op.create_index("ix_cameras_geom", "cameras", ["geom"], postgresql_using="gist")

    op.create_table(
        "thermal_frames",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("camera_id", uuid_type, nullable=False),
        sa.Column("capture_mode", sa.String(length=32), nullable=False),
        sa.Column("source_filename", sa.String(length=255), nullable=True),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("frame_index", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("pixel_format", sa.String(length=48), nullable=False),
        sa.Column("qc_passed", sa.Boolean(), nullable=False),
        sa.Column("qc_metrics", sa.JSON(), nullable=False),
        sa.Column("rejection_reason", sa.String(length=240), nullable=True),
        sa.Column("raw_object_key", sa.String(length=512), nullable=False),
        sa.Column("processed_object_key", sa.String(length=512), nullable=True),
        sa.Column("processing_status", sa.String(length=32), nullable=False),
        sa.Column("is_dev_test", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["camera_id"], ["cameras.id"], ondelete="CASCADE"),
        sa.CheckConstraint("frame_index >= 0", name="ck_thermal_frames_index"),
        sa.CheckConstraint("width >= 0", name="ck_thermal_frames_width"),
        sa.CheckConstraint("height >= 0", name="ck_thermal_frames_height"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_thermal_frames_camera_id", "thermal_frames", ["camera_id"])
    op.create_index("ix_thermal_frames_captured_at", "thermal_frames", ["captured_at"])
    op.create_index(
        "ix_thermal_frames_camera_captured",
        "thermal_frames",
        ["camera_id", "captured_at"],
    )
    op.create_index("ix_thermal_frames_qc_passed", "thermal_frames", ["qc_passed"])
    op.create_index(
        "ix_thermal_frames_qc_status",
        "thermal_frames",
        ["qc_passed", "processing_status"],
    )
    op.create_index("ix_thermal_frames_is_dev_test", "thermal_frames", ["is_dev_test"])


def downgrade() -> None:
    op.drop_table("thermal_frames")
    op.drop_table("cameras")
