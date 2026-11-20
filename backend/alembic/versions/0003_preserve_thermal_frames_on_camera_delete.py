"""Preserve historical thermal_frames when a camera is deleted

Revision ID: 0003_preserve_thermal_frames_on_camera_delete
Revises: 0002_cameras_and_thermal_frames
Create Date: 2026-11-20 03:40:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0003_preserve_thermal_frames_on_camera_delete"
down_revision: Union[str, Sequence[str], None] = "0002_cameras_and_thermal_frames"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _camera_fk_names(bind: sa.Connection) -> list[str]:
    inspector = sa.inspect(bind)
    names: list[str] = []
    for fk in inspector.get_foreign_keys("thermal_frames"):
        if fk.get("constrained_columns") == ["camera_id"] and fk.get("name"):
            names.append(str(fk["name"]))
    return names


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"
    uuid_type = postgresql.UUID(as_uuid=True) if is_pg else sa.CHAR(36)

    op.add_column(
        "thermal_frames",
        sa.Column("camera_code_snapshot", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "thermal_frames",
        sa.Column("camera_name_snapshot", sa.String(length=160), nullable=True),
    )
    op.add_column(
        "thermal_frames",
        sa.Column("zone_name_snapshot", sa.String(length=160), nullable=True),
    )

    # Backfill camera provenance snapshots for existing thermal_frames
    op.execute(
        sa.text(
            """
            UPDATE thermal_frames
            SET
              camera_code_snapshot = (SELECT c.camera_code FROM cameras c WHERE c.id = thermal_frames.camera_id),
              camera_name_snapshot = (SELECT c.name FROM cameras c WHERE c.id = thermal_frames.camera_id),
              zone_name_snapshot = (SELECT c.zone_name FROM cameras c WHERE c.id = thermal_frames.camera_id)
            WHERE camera_id IS NOT NULL
            """
        )
    )

    if is_pg:
        for fk_name in _camera_fk_names(bind):
            op.drop_constraint(fk_name, "thermal_frames", type_="foreignkey")
        op.alter_column(
            "thermal_frames",
            "camera_id",
            existing_type=uuid_type,
            nullable=True,
        )
        op.create_foreign_key(
            "fk_thermal_frames_camera_id",
            "thermal_frames",
            "cameras",
            ["camera_id"],
            ["id"],
            ondelete="SET NULL",
        )
    else:
        fk_names = _camera_fk_names(bind)
        with op.batch_alter_table("thermal_frames", recreate="always") as batch_op:
            for fk_name in fk_names:
                batch_op.drop_constraint(fk_name, type_="foreignkey")
            batch_op.alter_column(
                "camera_id",
                existing_type=uuid_type,
                nullable=True,
            )
            batch_op.create_foreign_key(
                "fk_thermal_frames_camera_id",
                "cameras",
                ["camera_id"],
                ["id"],
                ondelete="SET NULL",
            )


def downgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"
    uuid_type = postgresql.UUID(as_uuid=True) if is_pg else sa.CHAR(36)

    # Remove orphaned NULL camera_id rows only if downgrading to NOT NULL schema
    op.execute(sa.text("DELETE FROM thermal_frames WHERE camera_id IS NULL"))

    if is_pg:
        for fk_name in _camera_fk_names(bind):
            op.drop_constraint(fk_name, "thermal_frames", type_="foreignkey")
        op.alter_column(
            "thermal_frames",
            "camera_id",
            existing_type=uuid_type,
            nullable=False,
        )
        op.create_foreign_key(
            "thermal_frames_camera_id_fkey",
            "thermal_frames",
            "cameras",
            ["camera_id"],
            ["id"],
            ondelete="CASCADE",
        )
    else:
        fk_names = _camera_fk_names(bind)
        with op.batch_alter_table("thermal_frames", recreate="always") as batch_op:
            for fk_name in fk_names:
                batch_op.drop_constraint(fk_name, type_="foreignkey")
            batch_op.alter_column(
                "camera_id",
                existing_type=uuid_type,
                nullable=False,
            )
            batch_op.create_foreign_key(
                "fk_thermal_frames_camera_id",
                "cameras",
                ["camera_id"],
                ["id"],
                ondelete="CASCADE",
            )

    op.drop_column("thermal_frames", "zone_name_snapshot")
    op.drop_column("thermal_frames", "camera_name_snapshot")
    op.drop_column("thermal_frames", "camera_code_snapshot")
