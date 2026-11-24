"""Add users RBAC table, Re-ID species_family SQL filter columns/indexes, and thermal ingest idempotency

Revision ID: 0006_security_reid_idemp
Revises: 0005_reid_and_wicps_integ
Create Date: 2026-11-23 18:00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0006_security_reid_idemp"
down_revision: Union[str, Sequence[str], None] = "0005_reid_and_wicps_integ"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_SPECIES_FAMILY_CASE_SQL = """
CASE
    WHEN lower(coalesce(species, '')) LIKE '%elephant%' OR lower(coalesce(species, '')) LIKE '%elephas%' THEN 'elephant'
    WHEN lower(coalesce(species, '')) LIKE '%tiger%' OR lower(coalesce(species, '')) LIKE '%panthera tigris%' THEN 'tiger'
    WHEN lower(coalesce(species, '')) LIKE '%leopard%' OR lower(coalesce(species, '')) LIKE '%panthera pardus%' THEN 'leopard'
    WHEN lower(coalesce(species, '')) LIKE '%sloth bear%' OR lower(coalesce(species, '')) LIKE '%melursus ursinus%' THEN 'sloth_bear'
    WHEN lower(coalesce(species, '')) LIKE '%wild boar%' OR lower(coalesce(species, '')) LIKE '%sus scrofa%' THEN 'wild_boar'
    WHEN lower(coalesce(species, '')) LIKE '%gaur%' OR lower(coalesce(species, '')) LIKE '%bos gaurus%' OR lower(coalesce(species, '')) LIKE '%indian bison%' THEN 'gaur'
    WHEN lower(coalesce(species, '')) LIKE '%dhole%' OR lower(coalesce(species, '')) LIKE '%cuon alpinus%' OR lower(coalesce(species, '')) LIKE '%indian wild dog%' THEN 'dhole'
    WHEN lower(coalesce(species, '')) LIKE '%sambar%' OR lower(coalesce(species, '')) LIKE '%rusa unicolor%' THEN 'sambar'
    WHEN lower(coalesce(species, '')) LIKE '%chital%' OR lower(coalesce(species, '')) LIKE '%axis axis%' OR lower(coalesce(species, '')) LIKE '%spotted deer%' THEN 'chital'
    WHEN trim(coalesce(species, '')) = '' OR lower(trim(species)) IN ('unknown', 'unknown / needs review', 'blank', 'animal') THEN 'unknown'
    ELSE replace(lower(trim(species)), ' ', '_')
END
"""


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"
    uuid_type = postgresql.UUID(as_uuid=True) if is_pg else sa.CHAR(36)

    # 1. Users table for JWT / PBKDF2 authentication & RBAC
    op.create_table(
        "users",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("username", sa.String(length=80), nullable=False),
        sa.Column("display_name", sa.String(length=160), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False, server_default="operator"),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_username", "users", ["username"], unique=True)
    op.create_index("ix_users_role_active", "users", ["role", "is_active"], unique=False)

    # 2. Normalized species_family columns + composite indexes for SQL-level Re-ID filtering
    op.add_column(
        "animal_identities",
        sa.Column("species_family", sa.String(length=64), nullable=True),
    )
    op.execute(sa.text(f"UPDATE animal_identities SET species_family = {_SPECIES_FAMILY_CASE_SQL}"))
    if is_pg:
        op.alter_column(
            "animal_identities",
            "species_family",
            existing_type=sa.String(length=64),
            nullable=False,
            server_default="unknown",
        )
    else:
        with op.batch_alter_table("animal_identities") as batch_op:
            batch_op.alter_column(
                "species_family",
                existing_type=sa.String(length=64),
                nullable=False,
                server_default="unknown",
            )
    op.create_index(
        "ix_animal_identities_species_family",
        "animal_identities",
        ["species_family"],
        unique=False,
    )
    op.create_index(
        "ix_animal_identities_family_status",
        "animal_identities",
        ["species_family", "status"],
        unique=False,
    )

    op.add_column(
        "animal_embeddings",
        sa.Column("species_family", sa.String(length=64), nullable=True),
    )
    op.execute(sa.text(f"UPDATE animal_embeddings SET species_family = {_SPECIES_FAMILY_CASE_SQL}"))
    if is_pg:
        op.alter_column(
            "animal_embeddings",
            "species_family",
            existing_type=sa.String(length=64),
            nullable=False,
            server_default="unknown",
        )
    else:
        with op.batch_alter_table("animal_embeddings") as batch_op:
            batch_op.alter_column(
                "species_family",
                existing_type=sa.String(length=64),
                nullable=False,
                server_default="unknown",
            )
    op.create_index(
        "ix_animal_embeddings_species_family",
        "animal_embeddings",
        ["species_family"],
        unique=False,
    )
    op.create_index(
        "ix_animal_embeddings_family_ref",
        "animal_embeddings",
        ["species_family", "is_reference"],
        unique=False,
    )

    # 3. Idempotent thermal ingestion key & deduplication lookup index
    op.add_column(
        "thermal_frames",
        sa.Column("ingest_idempotency_key", sa.String(length=128), nullable=True),
    )
    op.create_index(
        "ix_thermal_frames_ingest_idempotency_key",
        "thermal_frames",
        ["ingest_idempotency_key"],
        unique=True,
    )
    op.create_index(
        "ix_thermal_frames_camera_dedup",
        "thermal_frames",
        ["camera_id", "capture_mode", "frame_index", "captured_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_thermal_frames_camera_dedup", table_name="thermal_frames")
    op.drop_index("ix_thermal_frames_ingest_idempotency_key", table_name="thermal_frames")
    op.drop_column("thermal_frames", "ingest_idempotency_key")

    op.drop_index("ix_animal_embeddings_family_ref", table_name="animal_embeddings")
    op.drop_index("ix_animal_embeddings_species_family", table_name="animal_embeddings")
    op.drop_column("animal_embeddings", "species_family")

    op.drop_index("ix_animal_identities_family_status", table_name="animal_identities")
    op.drop_index("ix_animal_identities_species_family", table_name="animal_identities")
    op.drop_column("animal_identities", "species_family")

    op.drop_index("ix_users_role_active", table_name="users")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
