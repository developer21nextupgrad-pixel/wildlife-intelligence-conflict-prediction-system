"""Add password_reset_tokens table and animal_detections soft-delete audit columns

Revision ID: 0007_auth_reset_and_det_archive
Revises: 0006_security_reid_idemp
Create Date: 2026-11-25 22:30:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0007_auth_reset_and_det_archive"
down_revision: Union[str, Sequence[str], None] = "0006_security_reid_idemp"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"
    uuid_type = postgresql.UUID(as_uuid=True) if is_pg else sa.CHAR(36)

    # 1. Password reset tokens table (hashed single-use tokens with expiration)
    op.create_table(
        "password_reset_tokens",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("user_id", uuid_type, nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("requested_ip", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_password_reset_tokens_user_id",
        "password_reset_tokens",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_password_reset_tokens_token_hash",
        "password_reset_tokens",
        ["token_hash"],
        unique=True,
    )
    op.create_index(
        "ix_password_reset_tokens_user_expires",
        "password_reset_tokens",
        ["user_id", "expires_at"],
        unique=False,
    )

    # 2. Animal detection ownership & soft-delete audit columns
    op.add_column(
        "animal_detections",
        sa.Column("uploaded_by_user_id", uuid_type, nullable=True),
    )
    op.add_column(
        "animal_detections",
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "animal_detections",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "animal_detections",
        sa.Column("deleted_by", sa.String(length=160), nullable=True),
    )
    op.add_column(
        "animal_detections",
        sa.Column("deletion_reason", sa.String(length=255), nullable=True),
    )

    if is_pg:
        op.create_foreign_key(
            "fk_animal_detections_uploaded_by_user_id",
            "animal_detections",
            "users",
            ["uploaded_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )

    op.create_index(
        "ix_animal_detections_deleted_created",
        "animal_detections",
        ["is_deleted", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_animal_detections_uploaded_by",
        "animal_detections",
        ["uploaded_by_user_id"],
        unique=False,
    )


def downgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    op.drop_index("ix_animal_detections_uploaded_by", table_name="animal_detections")
    op.drop_index("ix_animal_detections_deleted_created", table_name="animal_detections")
    if is_pg:
        op.drop_constraint(
            "fk_animal_detections_uploaded_by_user_id",
            "animal_detections",
            type_="foreignkey",
        )
    op.drop_column("animal_detections", "deletion_reason")
    op.drop_column("animal_detections", "deleted_by")
    op.drop_column("animal_detections", "deleted_at")
    op.drop_column("animal_detections", "is_deleted")
    op.drop_column("animal_detections", "uploaded_by_user_id")

    op.drop_index("ix_password_reset_tokens_user_expires", table_name="password_reset_tokens")
    op.drop_index("ix_password_reset_tokens_token_hash", table_name="password_reset_tokens")
    op.drop_index("ix_password_reset_tokens_user_id", table_name="password_reset_tokens")
    op.drop_table("password_reset_tokens")
