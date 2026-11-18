"""Initial WICPS PostGIS schema

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-11-16 00:00:00

"""
from typing import Sequence, Union

from alembic import op
import geoalchemy2
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial_schema"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    if is_pg:
        op.execute("CREATE EXTENSION IF NOT EXISTS postgis")

    uuid_type = postgresql.UUID(as_uuid=True) if is_pg else sa.CHAR(36)
    point_geom_type = (
        geoalchemy2.Geometry(geometry_type="POINT", srid=4326, spatial_index=False)
        if is_pg
        else sa.Text()
    )
    polygon_geom_type = (
        geoalchemy2.Geometry(geometry_type="POLYGON", srid=4326, spatial_index=False)
        if is_pg
        else sa.Text()
    )

    op.create_table(
        "villages",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("district", sa.String(length=120), nullable=False),
        sa.Column("forest_range", sa.String(length=120), nullable=False),
        sa.Column("population", sa.Integer(), nullable=False),
        sa.Column("households", sa.Integer(), nullable=False),
        sa.Column("forest_distance_km", sa.Float(), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("geom", point_geom_type, nullable=False),
        sa.Column("risk_level", sa.String(length=32), nullable=False),
        sa.Column("risk_score", sa.Integer(), nullable=False),
        sa.Column("active_solar_fence", sa.Boolean(), nullable=False),
        sa.Column("fence_status", sa.String(length=64), nullable=False),
        sa.Column("assigned_rrt", sa.String(length=160), nullable=False),
        sa.Column("emergency_contact", sa.String(length=120), nullable=False),
        sa.Column("recent_incidents_30d", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("is_demo", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.CheckConstraint("latitude >= -90.0 AND latitude <= 90.0", name="ck_villages_latitude"),
        sa.CheckConstraint("longitude >= -180.0 AND longitude <= 180.0", name="ck_villages_longitude"),
        sa.CheckConstraint("population >= 0", name="ck_villages_population"),
        sa.CheckConstraint("households >= 0", name="ck_villages_households"),
        sa.CheckConstraint("forest_distance_km >= 0", name="ck_villages_forest_distance"),
        sa.CheckConstraint("risk_score >= 0 AND risk_score <= 100", name="ck_villages_risk_score"),
        sa.CheckConstraint("recent_incidents_30d >= 0", name="ck_villages_recent_incidents"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index("ix_villages_district", "villages", ["district"])
    op.create_index("ix_villages_district_risk", "villages", ["district", "risk_level"])
    op.create_index("ix_villages_is_demo", "villages", ["is_demo"])
    if is_pg:
        op.create_index("ix_villages_geom", "villages", ["geom"], postgresql_using="gist")

    op.create_table(
        "incidents",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("incident_code", sa.String(length=64), nullable=False),
        sa.Column("species", sa.String(length=64), nullable=False),
        sa.Column("date_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("geom", point_geom_type, nullable=False),
        sa.Column("village_id", uuid_type, nullable=True),
        sa.Column("village", sa.String(length=160), nullable=False),
        sa.Column("district", sa.String(length=120), nullable=False),
        sa.Column("forest_range", sa.String(length=120), nullable=False),
        sa.Column("incident_type", sa.String(length=80), nullable=False),
        sa.Column("severity", sa.String(length=32), nullable=False),
        sa.Column("human_injury", sa.String(length=32), nullable=False),
        sa.Column("human_injuries_count", sa.Integer(), nullable=False),
        sa.Column("livestock_loss_count", sa.Integer(), nullable=False),
        sa.Column("crop_damage_estimated_acres", sa.Float(), nullable=False),
        sa.Column("crop_type", sa.String(length=160), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("image_url", sa.String(length=512), nullable=True),
        sa.Column("status", sa.String(length=48), nullable=False),
        sa.Column("reported_by", sa.String(length=160), nullable=False),
        sa.Column("assigned_officer", sa.String(length=160), nullable=True),
        sa.Column("action_taken", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("is_demo", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.ForeignKeyConstraint(["village_id"], ["villages.id"], ondelete="SET NULL"),
        sa.CheckConstraint("latitude >= -90.0 AND latitude <= 90.0", name="ck_incidents_latitude"),
        sa.CheckConstraint("longitude >= -180.0 AND longitude <= 180.0", name="ck_incidents_longitude"),
        sa.CheckConstraint("human_injuries_count >= 0", name="ck_incidents_human_injuries"),
        sa.CheckConstraint("livestock_loss_count >= 0", name="ck_incidents_livestock_loss"),
        sa.CheckConstraint("crop_damage_estimated_acres >= 0", name="ck_incidents_crop_damage"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("incident_code"),
    )
    op.create_index("ix_incidents_date_time", "incidents", ["date_time"])
    op.create_index("ix_incidents_district_dt", "incidents", ["district", "date_time"])
    op.create_index("ix_incidents_status_severity", "incidents", ["status", "severity"])
    op.create_index("ix_incidents_species", "incidents", ["species"])
    op.create_index("ix_incidents_village_id", "incidents", ["village_id"])
    op.create_index("ix_incidents_is_demo", "incidents", ["is_demo"])
    if is_pg:
        op.create_index("ix_incidents_geom", "incidents", ["geom"], postgresql_using="gist")

    op.create_table(
        "sightings",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("sighting_code", sa.String(length=64), nullable=False),
        sa.Column("species", sa.String(length=64), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("geom", point_geom_type, nullable=False),
        sa.Column("location_name", sa.String(length=200), nullable=False),
        sa.Column("district", sa.String(length=120), nullable=False),
        sa.Column("forest_range", sa.String(length=120), nullable=False),
        sa.Column("herd_size", sa.Integer(), nullable=False),
        sa.Column("movement_direction", sa.String(length=32), nullable=False),
        sa.Column("bearing_degrees", sa.Integer(), nullable=False),
        sa.Column("behavior", sa.String(length=64), nullable=False),
        sa.Column("juveniles_present", sa.Boolean(), nullable=False),
        sa.Column("observation_details", sa.Text(), nullable=False),
        sa.Column("observer_name", sa.String(length=160), nullable=False),
        sa.Column("observer_role", sa.String(length=120), nullable=False),
        sa.Column("verified_by_forest_guard", sa.Boolean(), nullable=False),
        sa.Column("photo_url", sa.String(length=512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("is_demo", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.CheckConstraint("latitude >= -90.0 AND latitude <= 90.0", name="ck_sightings_latitude"),
        sa.CheckConstraint("longitude >= -180.0 AND longitude <= 180.0", name="ck_sightings_longitude"),
        sa.CheckConstraint("herd_size >= 1", name="ck_sightings_herd_size"),
        sa.CheckConstraint("bearing_degrees >= 0 AND bearing_degrees <= 360", name="ck_sightings_bearing"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("sighting_code"),
    )
    op.create_index("ix_sightings_timestamp", "sightings", ["timestamp"])
    op.create_index("ix_sightings_district_ts", "sightings", ["district", "timestamp"])
    op.create_index("ix_sightings_species", "sightings", ["species"])
    op.create_index("ix_sightings_is_demo", "sightings", ["is_demo"])
    if is_pg:
        op.create_index("ix_sightings_geom", "sightings", ["geom"], postgresql_using="gist")

    op.create_table(
        "risk_zones",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("district", sa.String(length=120), nullable=False),
        sa.Column("forest_range", sa.String(length=120), nullable=False),
        sa.Column("village_id", uuid_type, nullable=True),
        sa.Column("risk_level", sa.String(length=32), nullable=False),
        sa.Column("risk_score", sa.Integer(), nullable=False),
        sa.Column("dominant_species", sa.String(length=64), nullable=False),
        sa.Column("center_lat", sa.Float(), nullable=False),
        sa.Column("center_lng", sa.Float(), nullable=False),
        sa.Column("polygon_coordinates", sa.JSON(), nullable=False),
        sa.Column("geom", polygon_geom_type, nullable=False),
        sa.Column("active_alert_count", sa.Integer(), nullable=False),
        sa.Column("primary_risk_factor", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("is_demo", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.ForeignKeyConstraint(["village_id"], ["villages.id"], ondelete="SET NULL"),
        sa.CheckConstraint("center_lat >= -90.0 AND center_lat <= 90.0", name="ck_risk_zones_lat"),
        sa.CheckConstraint("center_lng >= -180.0 AND center_lng <= 180.0", name="ck_risk_zones_lng"),
        sa.CheckConstraint("risk_score >= 0 AND risk_score <= 100", name="ck_risk_zones_score"),
        sa.CheckConstraint("active_alert_count >= 0", name="ck_risk_zones_alert_count"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index("ix_risk_zones_district_level", "risk_zones", ["district", "risk_level"])
    op.create_index("ix_risk_zones_village_id", "risk_zones", ["village_id"])
    op.create_index("ix_risk_zones_is_demo", "risk_zones", ["is_demo"])
    if is_pg:
        op.create_index("ix_risk_zones_geom", "risk_zones", ["geom"], postgresql_using="gist")

    op.create_table(
        "alerts",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("severity", sa.String(length=32), nullable=False),
        sa.Column("species", sa.String(length=64), nullable=False),
        sa.Column("affected_village", sa.String(length=160), nullable=False),
        sa.Column("village_id", uuid_type, nullable=True),
        sa.Column("district", sa.String(length=120), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("geom", point_geom_type, nullable=False),
        sa.Column("alert_time", sa.String(length=120), nullable=False),
        sa.Column("triggered_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("acknowledged", sa.Boolean(), nullable=False),
        sa.Column("acknowledged_by", sa.String(length=160), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("assigned_officer", sa.String(length=160), nullable=True),
        sa.Column("response_status", sa.String(length=48), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("is_demo", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.ForeignKeyConstraint(["village_id"], ["villages.id"], ondelete="SET NULL"),
        sa.CheckConstraint("latitude >= -90.0 AND latitude <= 90.0", name="ck_alerts_latitude"),
        sa.CheckConstraint("longitude >= -180.0 AND longitude <= 180.0", name="ck_alerts_longitude"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_alerts_district_ack", "alerts", ["district", "acknowledged"])
    op.create_index("ix_alerts_severity", "alerts", ["severity"])
    op.create_index("ix_alerts_village_id", "alerts", ["village_id"])
    op.create_index("ix_alerts_is_demo", "alerts", ["is_demo"])
    if is_pg:
        op.create_index("ix_alerts_geom", "alerts", ["geom"], postgresql_using="gist")

    op.create_table(
        "patrols",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("patrol_code", sa.String(length=64), nullable=False),
        sa.Column("team_name", sa.String(length=200), nullable=False),
        sa.Column("lead_officer", sa.String(length=160), nullable=False),
        sa.Column("target_area", sa.String(length=240), nullable=False),
        sa.Column("sector", sa.String(length=160), nullable=False),
        sa.Column("district", sa.String(length=120), nullable=False),
        sa.Column("village_id", uuid_type, nullable=True),
        sa.Column("priority", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=48), nullable=False),
        sa.Column("scheduled_window", sa.String(length=120), nullable=False),
        sa.Column("active_personnel", sa.Integer(), nullable=False),
        sa.Column("equipment", sa.JSON(), nullable=False),
        sa.Column("risk_rationale", sa.Text(), nullable=False),
        sa.Column("approved_by", sa.String(length=160), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("geom", point_geom_type, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("is_demo", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.ForeignKeyConstraint(["village_id"], ["villages.id"], ondelete="SET NULL"),
        sa.CheckConstraint("latitude >= -90.0 AND latitude <= 90.0", name="ck_patrols_latitude"),
        sa.CheckConstraint("longitude >= -180.0 AND longitude <= 180.0", name="ck_patrols_longitude"),
        sa.CheckConstraint("active_personnel >= 1", name="ck_patrols_personnel"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("patrol_code"),
    )
    op.create_index("ix_patrols_district_status", "patrols", ["district", "status"])
    op.create_index("ix_patrols_priority", "patrols", ["priority"])
    op.create_index("ix_patrols_village_id", "patrols", ["village_id"])
    op.create_index("ix_patrols_is_demo", "patrols", ["is_demo"])
    if is_pg:
        op.create_index("ix_patrols_geom", "patrols", ["geom"], postgresql_using="gist")

    op.create_table(
        "telemetry_records",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("animal_id", sa.String(length=64), nullable=False),
        sa.Column("animal_name", sa.String(length=160), nullable=False),
        sa.Column("species", sa.String(length=64), nullable=False),
        sa.Column("collar_battery", sa.Integer(), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("geom", point_geom_type, nullable=False),
        sa.Column("speed_kmh", sa.Float(), nullable=False),
        sa.Column("direction", sa.String(length=120), nullable=False),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("is_sensitive", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("is_demo", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.CheckConstraint("latitude >= -90.0 AND latitude <= 90.0", name="ck_telemetry_latitude"),
        sa.CheckConstraint("longitude >= -180.0 AND longitude <= 180.0", name="ck_telemetry_longitude"),
        sa.CheckConstraint("collar_battery >= 0 AND collar_battery <= 100", name="ck_telemetry_battery"),
        sa.CheckConstraint("speed_kmh >= 0", name="ck_telemetry_speed"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_telemetry_animal_recorded", "telemetry_records", ["animal_id", "recorded_at"])
    op.create_index("ix_telemetry_is_demo", "telemetry_records", ["is_demo"])
    if is_pg:
        op.create_index("ix_telemetry_geom", "telemetry_records", ["geom"], postgresql_using="gist")


def downgrade() -> None:
    op.drop_table("telemetry_records")
    op.drop_table("patrols")
    op.drop_table("alerts")
    op.drop_table("risk_zones")
    op.drop_table("sightings")
    op.drop_table("incidents")
    op.drop_table("villages")
