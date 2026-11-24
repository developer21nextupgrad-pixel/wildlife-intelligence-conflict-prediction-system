"""Add animal_detections table for Phase 1 animal detection and SpeciesNet identification

Revision ID: 0004_animal_detections
Revises: 0003_thermal_delete
Create Date: 2026-11-23 07:05:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0004_animal_detections"
down_revision: Union[str, Sequence[str], None] = "0003_thermal_delete"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"
    uuid_type = postgresql.UUID(as_uuid=True) if is_pg else sa.CHAR(36)

    op.create_table(
        "animal_detections",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("source_filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=64), nullable=False),
        sa.Column("file_size_bytes", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("image_object_key", sa.String(length=512), nullable=False),
        sa.Column("processing_status", sa.String(length=32), nullable=False),
        sa.Column("detection_count", sa.Integer(), nullable=False),
        sa.Column("animal_count", sa.Integer(), nullable=False),
        sa.Column("primary_species", sa.String(length=160), nullable=True),
        sa.Column("primary_common_name", sa.String(length=160), nullable=True),
        sa.Column("primary_scientific_name", sa.String(length=160), nullable=True),
        sa.Column("primary_confidence", sa.Float(), nullable=True),
        sa.Column("country_code", sa.String(length=16), nullable=True),
        sa.Column("admin1_region", sa.String(length=64), nullable=True),
        sa.Column("detector_model", sa.String(length=160), nullable=False),
        sa.Column("classifier_model", sa.String(length=160), nullable=False),
        sa.Column("inference_duration_ms", sa.Integer(), nullable=False),
        sa.Column("detections", sa.JSON(), nullable=False),
        sa.Column("error_message", sa.String(length=512), nullable=True),
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
        sa.CheckConstraint("file_size_bytes >= 0", name="ck_animal_detections_file_size"),
        sa.CheckConstraint("width >= 0", name="ck_animal_detections_width"),
        sa.CheckConstraint("height >= 0", name="ck_animal_detections_height"),
        sa.CheckConstraint("detection_count >= 0", name="ck_animal_detections_det_count"),
        sa.CheckConstraint("animal_count >= 0", name="ck_animal_detections_animal_count"),
        sa.CheckConstraint("inference_duration_ms >= 0", name="ck_animal_detections_duration"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_animal_detections_created_at", "animal_detections", ["created_at"])
    op.create_index("ix_animal_detections_status", "animal_detections", ["processing_status"])
    op.create_index(
        "ix_animal_detections_primary_species", "animal_detections", ["primary_species"]
    )


def downgrade() -> None:
    op.drop_index("ix_animal_detections_primary_species", table_name="animal_detections")
    op.drop_index("ix_animal_detections_status", table_name="animal_detections")
    op.drop_index("ix_animal_detections_created_at", table_name="animal_detections")
    op.drop_table("animal_detections")
