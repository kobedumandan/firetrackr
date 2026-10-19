"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-05-09

Creates all tables from the FireGIS ERD:
  users, admin, personnel, devices, location_logs,
  response_teams, response_team_members,
  truck, truck_logs, purok_boundaries,
  fire_incidents, routes, heatmap_data,
  dispatch_records, dispatch_trucks
"""

from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------ users
    op.create_table(
        "users",
        sa.Column("user_id",       sa.Integer(),     primary_key=True, autoincrement=True),
        sa.Column("user_email",    sa.String(255),   nullable=False),
        sa.Column("user_password", sa.String(255),   nullable=False),
        sa.Column("user_role",     sa.String(50),    nullable=True),
        sa.Column("created_at",    sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at",    sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("user_email", name="uq_users_email"),
    )

    # ------------------------------------------------------------------ admin
    op.create_table(
        "admin",
        sa.Column("admin_id",        sa.Integer(),   primary_key=True, autoincrement=True),
        sa.Column("admin_firstname",  sa.String(100), nullable=True),
        sa.Column("admin_lastname",   sa.String(100), nullable=True),
        sa.Column("admin_contact",    sa.String(50),  nullable=True),
        sa.Column("user_id",          sa.Integer(),   nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.user_id"], name="fk_admin_user"),
    )

    # --------------------------------------------------------- purok_boundaries
    op.create_table(
        "purok_boundaries",
        sa.Column("purok_id",      sa.Integer(),    primary_key=True, autoincrement=True),
        sa.Column("purok_name",    sa.String(150),  nullable=True),
        sa.Column("purok_geojson", sa.Text(),       nullable=True),
    )

    # --------------------------------------------------------------- personnel
    op.create_table(
        "personnel",
        sa.Column("per_id",          sa.Integer(),   primary_key=True, autoincrement=True),
        sa.Column("per_firstname",   sa.String(100), nullable=True),
        sa.Column("per_lastname",    sa.String(100), nullable=True),
        sa.Column("per_contact",     sa.String(50),  nullable=True),
        sa.Column("per_rank",        sa.String(100), nullable=True),
        sa.Column("per_designation", sa.String(100), nullable=True),
        sa.Column("user_id",         sa.Integer(),   nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.user_id"], name="fk_personnel_user"),
    )

    # ----------------------------------------------------------------- devices
    op.create_table(
        "devices",
        sa.Column("device_id",       sa.Integer(),             primary_key=True, autoincrement=True),
        sa.Column("device_imei",     sa.String(20),            nullable=True),
        sa.Column("device_sim",      sa.String(20),            nullable=True),
        sa.Column("device_status",   sa.String(50),            nullable=True),
        sa.Column("device_lastseen", sa.DateTime(timezone=True), nullable=True),
        sa.Column("per_id",          sa.Integer(),             nullable=False),
        sa.ForeignKeyConstraint(["per_id"], ["personnel.per_id"], name="fk_devices_personnel"),
        sa.UniqueConstraint("device_imei", name="uq_devices_imei"),
    )

    # ----------------------------------------------------------- location_logs
    op.create_table(
        "location_logs",
        sa.Column("log_id",         sa.Integer(),             primary_key=True, autoincrement=True),
        sa.Column("device_id",      sa.Integer(),             nullable=False),
        sa.Column("log_latitude",   sa.Float(),               nullable=False),
        sa.Column("log_longitude",  sa.Float(),               nullable=False),
        sa.Column("log_receive_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["device_id"], ["devices.device_id"], name="fk_location_logs_device"),
    )

    # ---------------------------------------------------------- response_teams
    op.create_table(
        "response_teams",
        sa.Column("team_id",         sa.Integer(),             primary_key=True, autoincrement=True),
        sa.Column("team_name",       sa.String(150),           nullable=True),
        sa.Column("team_status",     sa.String(50),            nullable=True),
        sa.Column("team_created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("team_updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    # -------------------------------------------------- response_team_members
    op.create_table(
        "response_team_members",
        sa.Column("members_id",    sa.Integer(),  primary_key=True, autoincrement=True),
        sa.Column("team_id",       sa.Integer(),  nullable=False),
        sa.Column("per_id",        sa.Integer(),  nullable=False),
        sa.Column("member_role",   sa.String(100), nullable=True),
        sa.Column("member_status", sa.String(50),  nullable=True),
        sa.ForeignKeyConstraint(["team_id"], ["response_teams.team_id"], name="fk_rtm_team"),
        sa.ForeignKeyConstraint(["per_id"],  ["personnel.per_id"],       name="fk_rtm_personnel"),
    )

    # ------------------------------------------------------------------- truck
    op.create_table(
        "truck",
        sa.Column("truck_id",           sa.Integer(),             primary_key=True, autoincrement=True),
        sa.Column("truck_platenum",      sa.String(20),            nullable=True),
        sa.Column("truck_status",        sa.String(50),            nullable=True),
        sa.Column("truck_latitude",      sa.Float(),               nullable=True),
        sa.Column("truck_longitude",     sa.Float(),               nullable=True),
        sa.Column("truck_last_updated",  sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("truck_platenum", name="uq_truck_platenum"),
    )

    # --------------------------------------------------------------- truck_logs
    op.create_table(
        "truck_logs",
        sa.Column("truck_log_id",       sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("truck_id",           sa.Integer(), nullable=False),
        sa.Column("truck_log_lat",      sa.Float(),   nullable=False),
        sa.Column("truck_log_long",     sa.Float(),   nullable=False),
        sa.Column("truck_log_recorded", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["truck_id"], ["truck.truck_id"], name="fk_truck_logs_truck"),
    )

    # --------------------------------------------------------- fire_incidents
    op.create_table(
        "fire_incidents",
        sa.Column("fire_id",                sa.Integer(),             primary_key=True, autoincrement=True),
        sa.Column("confirmed_user_id",      sa.Integer(),             nullable=True),
        sa.Column("purok_id",               sa.Integer(),             nullable=True),
        sa.Column("fire_reporter_contact",  sa.String(50),            nullable=True),
        sa.Column("fire_location_source",   sa.String(100),           nullable=True),
        sa.Column("fire_latitude",          sa.Float(),               nullable=False),
        sa.Column("fire_longitude",         sa.Float(),               nullable=False),
        sa.Column("fire_severity",          sa.String(50),            nullable=True),
        sa.Column("fire_status",            sa.String(50),            nullable=True),
        sa.Column("fire_incident_datetime", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["confirmed_user_id"], ["users.user_id"],             name="fk_fi_user"),
        sa.ForeignKeyConstraint(["purok_id"],          ["purok_boundaries.purok_id"], name="fk_fi_purok"),
    )

    # ------------------------------------------------------------------ routes
    op.create_table(
        "routes",
        sa.Column("route_id",              sa.Integer(),  primary_key=True, autoincrement=True),
        sa.Column("fire_id",               sa.Integer(),  nullable=False),
        sa.Column("route_rank",            sa.Integer(),  nullable=True),
        sa.Column("route_type",            sa.String(50), nullable=True),
        sa.Column("route_path_geojson",    sa.Text(),     nullable=True),
        sa.Column("route_distance_meters", sa.Float(),    nullable=True),
        sa.Column("route_est_minutes",     sa.Float(),    nullable=True),
        sa.Column("route_is_selected",     sa.Boolean(),  nullable=True, server_default=sa.false()),
        sa.Column("route_created_at",      sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["fire_id"], ["fire_incidents.fire_id"], name="fk_routes_fire"),
    )

    # -------------------------------------------------------------- heatmap_data
    op.create_table(
        "heatmap_data",
        sa.Column("heatmap_id",              sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("fire_id",                 sa.Integer(), nullable=False),
        sa.Column("heatmap_latitude",        sa.Float(),   nullable=False),
        sa.Column("heatmap_longitude",       sa.Float(),   nullable=False),
        sa.Column("heatmap_severity_weight", sa.Float(),   nullable=True),
        sa.Column("heatmap_density_value",   sa.Float(),   nullable=True),
        sa.Column("heatmap_generated_at",    sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["fire_id"], ["fire_incidents.fire_id"], name="fk_heatmap_fire"),
    )

    # --------------------------------------------------------- dispatch_records
    op.create_table(
        "dispatch_records",
        sa.Column("dispatch_id",           sa.Integer(),             primary_key=True, autoincrement=True),
        sa.Column("fire_id",               sa.Integer(),             nullable=False),
        sa.Column("team_id",               sa.Integer(),             nullable=False),
        sa.Column("route_id",              sa.Integer(),             nullable=True),
        sa.Column("dispatch_status",       sa.String(50),            nullable=True),
        sa.Column("dispatch_at",           sa.DateTime(timezone=True), nullable=True),
        sa.Column("dispatch_arrived_at",   sa.DateTime(timezone=True), nullable=True),
        sa.Column("dispatch_completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("dispatch_truck_count",  sa.Integer(),             nullable=True, server_default="0"),
        sa.ForeignKeyConstraint(["fire_id"],  ["fire_incidents.fire_id"],  name="fk_dr_fire"),
        sa.ForeignKeyConstraint(["team_id"],  ["response_teams.team_id"],  name="fk_dr_team"),
        sa.ForeignKeyConstraint(["route_id"], ["routes.route_id"],         name="fk_dr_route"),
    )

    # ---------------------------------------------------------- dispatch_trucks
    op.create_table(
        "dispatch_trucks",
        sa.Column("dispatch_truck_id", sa.Integer(),             primary_key=True, autoincrement=True),
        sa.Column("dispatch_id",       sa.Integer(),             nullable=False),
        sa.Column("truck_id",          sa.Integer(),             nullable=False),
        sa.Column("truck_assigned_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["dispatch_id"], ["dispatch_records.dispatch_id"], name="fk_dt_dispatch"),
        sa.ForeignKeyConstraint(["truck_id"],    ["truck.truck_id"],               name="fk_dt_truck"),
    )


def downgrade() -> None:
    # Drop in reverse FK dependency order
    op.drop_table("dispatch_trucks")
    op.drop_table("dispatch_records")
    op.drop_table("heatmap_data")
    op.drop_table("routes")
    op.drop_table("fire_incidents")
    op.drop_table("truck_logs")
    op.drop_table("truck")
    op.drop_table("response_team_members")
    op.drop_table("response_teams")
    op.drop_table("location_logs")
    op.drop_table("devices")
    op.drop_table("personnel")
    op.drop_table("purok_boundaries")
    op.drop_table("admin")
    op.drop_table("users")
