"""Add Phase 2 individual animal Re-ID tables (pgvector) and Phase 3 WICPS integration columns/tables

Revision ID: 0005_reid_and_wicps_integ
Revises: 0004_animal_detections
Create Date: 2026-11-23 12:00:00

"""

from typing import Sequence, Union

from alembic import op
from pgvector.sqlalchemy import Vector as PGVector
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0005_reid_and_wicps_integ"
down_revision: Union[str, Sequence[str], None] = "0004_animal_detections"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"
    uuid_type = postgresql.UUID(as_uuid=True) if is_pg else sa.CHAR(36)
    vector_type = PGVector(768) if is_pg else sa.JSON()

    if is_pg:
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # 1. Animal code sequence counter
    op.create_table(
        "animal_code_sequences",
        sa.Column("species_prefix", sa.String(length=16), nullable=False),
        sa.Column("last_number", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("species_prefix"),
    )

    # 2. Persistent animal identities registry
    op.create_table(
        "animal_identities",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("animal_code", sa.String(length=32), nullable=False),
        sa.Column("species", sa.String(length=160), nullable=False),
        sa.Column("scientific_name", sa.String(length=160), nullable=True),
        sa.Column("species_prefix", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column(
            "verification_status",
            sa.String(length=32),
            nullable=False,
            server_default="provisional",
        ),
        sa.Column("primary_crop_object_key", sa.String(length=512), nullable=True),
        sa.Column(
            "first_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("total_sightings", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("reference_image_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint("total_sightings >= 0", name="ck_animal_identities_sightings"),
        sa.CheckConstraint("reference_image_count >= 0", name="ck_animal_identities_ref_count"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("animal_code", name="uq_animal_identities_animal_code"),
    )
    op.create_index("ix_animal_identities_species", "animal_identities", ["species"])
    op.create_index("ix_animal_identities_species_prefix", "animal_identities", ["species_prefix"])
    op.create_index(
        "ix_animal_identities_species_status", "animal_identities", ["species", "status"]
    )
    op.create_index("ix_animal_identities_last_seen_at", "animal_identities", ["last_seen_at"])

    # 3. Animal embeddings (pgvector on PostgreSQL, JSON on SQLite)
    op.create_table(
        "animal_embeddings",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("detection_id", uuid_type, nullable=False),
        sa.Column("detection_item_index", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("animal_identity_id", uuid_type, nullable=True),
        sa.Column("crop_object_key", sa.String(length=512), nullable=False),
        sa.Column("species", sa.String(length=160), nullable=False),
        sa.Column("model_name", sa.String(length=160), nullable=False),
        sa.Column("model_version", sa.String(length=64), nullable=False),
        sa.Column("embedding_dim", sa.Integer(), nullable=False, server_default="768"),
        sa.Column("embedding", vector_type, nullable=False),
        sa.Column("crop_width", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("crop_height", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("blur_score", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("quality_passed", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("is_reference", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint("embedding_dim > 0", name="ck_animal_embeddings_dim"),
        sa.CheckConstraint("detection_item_index >= 1", name="ck_animal_embeddings_item_idx"),
        sa.ForeignKeyConstraint(["detection_id"], ["animal_detections.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["animal_identity_id"], ["animal_identities.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_animal_embeddings_species_ref", "animal_embeddings", ["species", "is_reference"])
    op.create_index("ix_animal_embeddings_identity_id", "animal_embeddings", ["animal_identity_id"])
    op.create_index("ix_animal_embeddings_detection_id", "animal_embeddings", ["detection_id"])
    if is_pg:
        op.execute(
            "CREATE INDEX IF NOT EXISTS ix_animal_embeddings_hnsw_cosine "
            "ON animal_embeddings USING hnsw (embedding vector_cosine_ops)"
        )

    # 4. Re-ID matches
    op.create_table(
        "reid_matches",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("detection_id", uuid_type, nullable=False),
        sa.Column("embedding_id", uuid_type, nullable=False),
        sa.Column("detection_item_index", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("species", sa.String(length=160), nullable=False),
        sa.Column("matched_animal_id", uuid_type, nullable=True),
        sa.Column("suggested_animal_id", uuid_type, nullable=True),
        sa.Column("similarity_score", sa.Float(), nullable=True),
        sa.Column("decision", sa.String(length=32), nullable=False),
        sa.Column("review_status", sa.String(length=32), nullable=False),
        sa.Column("review_reason", sa.Text(), nullable=True),
        sa.Column("top_candidates", sa.JSON(), nullable=False),
        sa.Column("model_version", sa.String(length=160), nullable=False),
        sa.Column("thresholds_snapshot", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["detection_id"], ["animal_detections.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["embedding_id"], ["animal_embeddings.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["matched_animal_id"], ["animal_identities.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["suggested_animal_id"], ["animal_identities.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_reid_matches_detection_id", "reid_matches", ["detection_id"])
    op.create_index("ix_reid_matches_matched_animal_id", "reid_matches", ["matched_animal_id"])
    op.create_index("ix_reid_matches_review_status", "reid_matches", ["review_status"])
    op.create_index("ix_reid_matches_decision", "reid_matches", ["decision"])

    # 5. Identity manual review audit logs
    op.create_table(
        "identity_review_logs",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("match_id", uuid_type, nullable=False),
        sa.Column("animal_identity_id", uuid_type, nullable=True),
        sa.Column("previous_animal_id", uuid_type, nullable=True),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("reviewed_by", sa.String(length=160), nullable=False),
        sa.Column(
            "reviewed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["match_id"], ["reid_matches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["animal_identity_id"], ["animal_identities.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["previous_animal_id"], ["animal_identities.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_identity_review_logs_match_id", "identity_review_logs", ["match_id"])
    op.create_index("ix_identity_review_logs_reviewed_at", "identity_review_logs", ["reviewed_at"])

    # 6. Configurable alert rules
    op.create_table(
        "alert_rules",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("species_filter", sa.String(length=160), nullable=True),
        sa.Column("risk_level", sa.String(length=32), nullable=False, server_default="High"),
        sa.Column("village_id", uuid_type, nullable=True),
        sa.Column("zone_name", sa.String(length=160), nullable=True),
        sa.Column("min_repeat_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("time_window_minutes", sa.Integer(), nullable=False, server_default="120"),
        sa.Column("min_species_confidence", sa.Float(), nullable=False, server_default="0.5"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "auto_notify_officer", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column(
            "auto_dispatch_iot_boundary",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint("min_repeat_count >= 1", name="ck_alert_rules_min_repeat"),
        sa.CheckConstraint("time_window_minutes >= 1", name="ck_alert_rules_window"),
        sa.ForeignKeyConstraint(["village_id"], ["villages.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_alert_rules_name"),
    )
    op.create_index("ix_alert_rules_village_id", "alert_rules", ["village_id"])
    op.create_index(
        "ix_alert_rules_enabled_species", "alert_rules", ["enabled", "species_filter"]
    )

    # 7. Forest officers roster for spatial/range routing
    op.create_table(
        "forest_officers",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("badge_number", sa.String(length=64), nullable=False),
        sa.Column("role", sa.String(length=120), nullable=False),
        sa.Column("forest_range", sa.String(length=120), nullable=False),
        sa.Column(
            "district",
            sa.String(length=120),
            nullable=False,
            server_default="Bandipur Division",
        ),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column(
            "whatsapp_opt_in", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column("sms_opt_in", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "contact_channel",
            sa.String(length=32),
            nullable=False,
            server_default="whatsapp_stub",
        ),
        sa.Column("duty_status", sa.String(length=48), nullable=False, server_default="On Duty"),
        sa.Column("on_duty", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "notification_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("badge_number", name="uq_forest_officers_badge_number"),
    )
    op.create_index("ix_forest_officers_forest_range", "forest_officers", ["forest_range"])
    op.create_index(
        "ix_forest_officers_range_duty", "forest_officers", ["forest_range", "on_duty"]
    )

    # 8. Alert notification delivery audit log
    op.create_table(
        "alert_delivery_attempts",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("alert_id", uuid_type, nullable=False),
        sa.Column("officer_id", uuid_type, nullable=True),
        sa.Column("officer_name", sa.String(length=160), nullable=False),
        sa.Column("channel", sa.String(length=32), nullable=False),
        sa.Column("routing_basis", sa.String(length=48), nullable=False),
        sa.Column("distance_km", sa.Float(), nullable=True),
        sa.Column("status", sa.String(length=48), nullable=False),
        sa.Column("attempt_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column(
            "attempted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["alert_id"], ["alerts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["officer_id"], ["forest_officers.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_alert_delivery_attempts_alert_id", "alert_delivery_attempts", ["alert_id"]
    )
    op.create_index(
        "ix_alert_delivery_attempts_officer_id", "alert_delivery_attempts", ["officer_id"]
    )
    op.create_index(
        "ix_alert_delivery_attempts_attempted_at", "alert_delivery_attempts", ["attempted_at"]
    )

    # 9. IoT siren / boundary alert integration boundary contract log
    op.create_table(
        "iot_event_records",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("alert_id", uuid_type, nullable=True),
        sa.Column("camera_id", uuid_type, nullable=True),
        sa.Column("device_code", sa.String(length=64), nullable=False),
        sa.Column("animal_identity_id", uuid_type, nullable=True),
        sa.Column("species", sa.String(length=160), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("risk_level", sa.String(length=32), nullable=False, server_default="High"),
        sa.Column(
            "event_type",
            sa.String(length=64),
            nullable=False,
            server_default="boundary_alert_dispatch",
        ),
        sa.Column("is_dev_test", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column(
            "delivery_status",
            sa.String(length=32),
            nullable=False,
            server_default="pending_ack",
        ),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_by", sa.String(length=160), nullable=True),
        sa.Column("ack_note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint("retry_count >= 0", name="ck_iot_event_records_retries"),
        sa.ForeignKeyConstraint(["alert_id"], ["alerts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["camera_id"], ["cameras.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["animal_identity_id"], ["animal_identities.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_iot_event_records_status", "iot_event_records", ["delivery_status"])
    op.create_index("ix_iot_event_records_camera_id", "iot_event_records", ["camera_id"])
    op.create_index("ix_iot_event_records_alert_id", "iot_event_records", ["alert_id"])

    # 10. Additive columns on existing tables: animal_detections, sightings, alerts
    with op.batch_alter_table("animal_detections") as batch_op:
        batch_op.add_column(sa.Column("camera_id", uuid_type, nullable=True))
        batch_op.add_column(sa.Column("village_id", uuid_type, nullable=True))
        batch_op.add_column(sa.Column("captured_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("latitude", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("longitude", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("location_name", sa.String(length=200), nullable=True))
        batch_op.add_column(sa.Column("idempotency_key", sa.String(length=128), nullable=True))
        batch_op.add_column(sa.Column("generated_sighting_id", uuid_type, nullable=True))
        batch_op.add_column(
            sa.Column(
                "generated_alert_ids",
                sa.JSON(),
                nullable=False,
                server_default=sa.text("'[]'"),
            )
        )
        batch_op.create_foreign_key(
            "fk_animal_detections_camera_id", "cameras", ["camera_id"], ["id"], ondelete="SET NULL"
        )
        batch_op.create_foreign_key(
            "fk_animal_detections_village_id", "villages", ["village_id"], ["id"], ondelete="SET NULL"
        )
        batch_op.create_foreign_key(
            "fk_animal_detections_sighting_id",
            "sightings",
            ["generated_sighting_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index("ix_animal_detections_camera_id", "animal_detections", ["camera_id"])
    op.create_index(
        "ix_animal_detections_idempotency_key",
        "animal_detections",
        ["idempotency_key"],
        unique=True,
    )

    with op.batch_alter_table("sightings") as batch_op:
        batch_op.add_column(sa.Column("animal_detection_id", uuid_type, nullable=True))
        batch_op.add_column(sa.Column("animal_identity_id", uuid_type, nullable=True))
        batch_op.add_column(sa.Column("camera_id", uuid_type, nullable=True))
        batch_op.add_column(sa.Column("village_id", uuid_type, nullable=True))
        batch_op.add_column(sa.Column("external_ref_key", sa.String(length=160), nullable=True))
        batch_op.create_foreign_key(
            "fk_sightings_animal_detection_id",
            "animal_detections",
            ["animal_detection_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            "fk_sightings_animal_identity_id",
            "animal_identities",
            ["animal_identity_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            "fk_sightings_camera_id", "cameras", ["camera_id"], ["id"], ondelete="SET NULL"
        )
        batch_op.create_foreign_key(
            "fk_sightings_village_id", "villages", ["village_id"], ["id"], ondelete="SET NULL"
        )
    op.create_index("ix_sightings_animal_detection_id", "sightings", ["animal_detection_id"])
    op.create_index("ix_sightings_animal_identity_id", "sightings", ["animal_identity_id"])
    op.create_index("ix_sightings_camera_id", "sightings", ["camera_id"])
    op.create_index("ix_sightings_village_id", "sightings", ["village_id"])
    op.create_index(
        "ix_sightings_external_ref_key", "sightings", ["external_ref_key"], unique=True
    )

    with op.batch_alter_table("alerts") as batch_op:
        batch_op.add_column(sa.Column("sighting_id", uuid_type, nullable=True))
        batch_op.add_column(sa.Column("animal_identity_id", uuid_type, nullable=True))
        batch_op.add_column(sa.Column("animal_detection_id", uuid_type, nullable=True))
        batch_op.add_column(sa.Column("alert_rule_id", uuid_type, nullable=True))
        batch_op.add_column(sa.Column("image_url", sa.String(length=512), nullable=True))
        batch_op.add_column(sa.Column("risk_reason", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("external_ref_key", sa.String(length=160), nullable=True))
        batch_op.create_foreign_key(
            "fk_alerts_sighting_id", "sightings", ["sighting_id"], ["id"], ondelete="SET NULL"
        )
        batch_op.create_foreign_key(
            "fk_alerts_animal_identity_id",
            "animal_identities",
            ["animal_identity_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            "fk_alerts_animal_detection_id",
            "animal_detections",
            ["animal_detection_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            "fk_alerts_alert_rule_id", "alert_rules", ["alert_rule_id"], ["id"], ondelete="SET NULL"
        )
    op.create_index("ix_alerts_sighting_id", "alerts", ["sighting_id"])
    op.create_index("ix_alerts_animal_identity_id", "alerts", ["animal_identity_id"])
    op.create_index("ix_alerts_animal_detection_id", "alerts", ["animal_detection_id"])
    op.create_index("ix_alerts_alert_rule_id", "alerts", ["alert_rule_id"])
    op.create_index("ix_alerts_external_ref_key", "alerts", ["external_ref_key"], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    op.drop_index("ix_alerts_external_ref_key", table_name="alerts")
    op.drop_index("ix_alerts_alert_rule_id", table_name="alerts")
    op.drop_index("ix_alerts_animal_detection_id", table_name="alerts")
    op.drop_index("ix_alerts_animal_identity_id", table_name="alerts")
    op.drop_index("ix_alerts_sighting_id", table_name="alerts")
    with op.batch_alter_table("alerts") as batch_op:
        batch_op.drop_constraint("fk_alerts_alert_rule_id", type_="foreignkey")
        batch_op.drop_constraint("fk_alerts_animal_detection_id", type_="foreignkey")
        batch_op.drop_constraint("fk_alerts_animal_identity_id", type_="foreignkey")
        batch_op.drop_constraint("fk_alerts_sighting_id", type_="foreignkey")
        batch_op.drop_column("external_ref_key")
        batch_op.drop_column("risk_reason")
        batch_op.drop_column("image_url")
        batch_op.drop_column("alert_rule_id")
        batch_op.drop_column("animal_detection_id")
        batch_op.drop_column("animal_identity_id")
        batch_op.drop_column("sighting_id")

    op.drop_index("ix_sightings_external_ref_key", table_name="sightings")
    op.drop_index("ix_sightings_village_id", table_name="sightings")
    op.drop_index("ix_sightings_camera_id", table_name="sightings")
    op.drop_index("ix_sightings_animal_identity_id", table_name="sightings")
    op.drop_index("ix_sightings_animal_detection_id", table_name="sightings")
    with op.batch_alter_table("sightings") as batch_op:
        batch_op.drop_constraint("fk_sightings_village_id", type_="foreignkey")
        batch_op.drop_constraint("fk_sightings_camera_id", type_="foreignkey")
        batch_op.drop_constraint("fk_sightings_animal_identity_id", type_="foreignkey")
        batch_op.drop_constraint("fk_sightings_animal_detection_id", type_="foreignkey")
        batch_op.drop_column("external_ref_key")
        batch_op.drop_column("village_id")
        batch_op.drop_column("camera_id")
        batch_op.drop_column("animal_identity_id")
        batch_op.drop_column("animal_detection_id")

    op.drop_index("ix_animal_detections_idempotency_key", table_name="animal_detections")
    op.drop_index("ix_animal_detections_camera_id", table_name="animal_detections")
    with op.batch_alter_table("animal_detections") as batch_op:
        batch_op.drop_constraint("fk_animal_detections_sighting_id", type_="foreignkey")
        batch_op.drop_constraint("fk_animal_detections_village_id", type_="foreignkey")
        batch_op.drop_constraint("fk_animal_detections_camera_id", type_="foreignkey")
        batch_op.drop_column("generated_alert_ids")
        batch_op.drop_column("generated_sighting_id")
        batch_op.drop_column("idempotency_key")
        batch_op.drop_column("location_name")
        batch_op.drop_column("longitude")
        batch_op.drop_column("latitude")
        batch_op.drop_column("captured_at")
        batch_op.drop_column("village_id")
        batch_op.drop_column("camera_id")

    op.drop_index("ix_iot_event_records_alert_id", table_name="iot_event_records")
    op.drop_index("ix_iot_event_records_camera_id", table_name="iot_event_records")
    op.drop_index("ix_iot_event_records_status", table_name="iot_event_records")
    op.drop_table("iot_event_records")

    op.drop_index("ix_alert_delivery_attempts_attempted_at", table_name="alert_delivery_attempts")
    op.drop_index("ix_alert_delivery_attempts_officer_id", table_name="alert_delivery_attempts")
    op.drop_index("ix_alert_delivery_attempts_alert_id", table_name="alert_delivery_attempts")
    op.drop_table("alert_delivery_attempts")

    op.drop_index("ix_forest_officers_range_duty", table_name="forest_officers")
    op.drop_index("ix_forest_officers_forest_range", table_name="forest_officers")
    op.drop_table("forest_officers")

    op.drop_index("ix_alert_rules_enabled_species", table_name="alert_rules")
    op.drop_index("ix_alert_rules_village_id", table_name="alert_rules")
    op.drop_table("alert_rules")

    op.drop_index("ix_identity_review_logs_reviewed_at", table_name="identity_review_logs")
    op.drop_index("ix_identity_review_logs_match_id", table_name="identity_review_logs")
    op.drop_table("identity_review_logs")

    op.drop_index("ix_reid_matches_decision", table_name="reid_matches")
    op.drop_index("ix_reid_matches_review_status", table_name="reid_matches")
    op.drop_index("ix_reid_matches_matched_animal_id", table_name="reid_matches")
    op.drop_index("ix_reid_matches_detection_id", table_name="reid_matches")
    op.drop_table("reid_matches")

    if is_pg:
        op.execute("DROP INDEX IF EXISTS ix_animal_embeddings_hnsw_cosine")
    op.drop_index("ix_animal_embeddings_detection_id", table_name="animal_embeddings")
    op.drop_index("ix_animal_embeddings_identity_id", table_name="animal_embeddings")
    op.drop_index("ix_animal_embeddings_species_ref", table_name="animal_embeddings")
    op.drop_table("animal_embeddings")

    op.drop_index("ix_animal_identities_last_seen_at", table_name="animal_identities")
    op.drop_index("ix_animal_identities_species_status", table_name="animal_identities")
    op.drop_index("ix_animal_identities_species_prefix", table_name="animal_identities")
    op.drop_index("ix_animal_identities_species", table_name="animal_identities")
    op.drop_table("animal_identities")

    op.drop_table("animal_code_sequences")
