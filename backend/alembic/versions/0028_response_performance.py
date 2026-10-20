"""Response context, milestones and samples; legacy route snapshots are labeled."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("dispatch_locations",
        sa.Column("sample_id", sa.Integer(), primary_key=True),
        sa.Column("dispatch_id", sa.Integer(), sa.ForeignKey("dispatch_records.dispatch_id", ondelete="CASCADE"), nullable=False),
        sa.Column("per_id", sa.Integer(), sa.ForeignKey("personnel.per_id", ondelete="SET NULL")),
        sa.Column("truck_id", sa.Integer(), sa.ForeignKey("truck.truck_id", ondelete="SET NULL")),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False), sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("accuracy_m", sa.Float()), sa.Column("source", sa.String(30), nullable=False),
        sa.Column("sample_key", sa.String(160), nullable=False, unique=True),
        sa.CheckConstraint("latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180", name="ck_response_location_range"),
        sa.CheckConstraint("accuracy_m >= 0", name="ck_response_location_accuracy"))
    op.create_index("ix_response_location_dispatch_time", "dispatch_locations", ["dispatch_id", "recorded_at"])
    op.add_column("truck_logs", sa.Column("per_id", sa.Integer()))
    op.create_foreign_key("fk_response_log_personnel", "truck_logs", "personnel", ["per_id"], ["per_id"], ondelete="SET NULL")
    op.create_index("ix_response_unit_sample_time", "truck_logs", ["dispatch_truck_id", "truck_log_recorded"])
    op.add_column("fire_incidents", sa.Column("created_at", sa.DateTime(timezone=True)))
    op.add_column("fire_incidents", sa.Column("record_kind", sa.String(20)))
    op.create_check_constraint("ck_response_record_kind", "fire_incidents",
                               "record_kind IN ('operational', 'drill', 'test', 'unknown')")
    for name in ("acknowledged_at", "departed_at"):
        op.add_column("dispatch_records", sa.Column(name, sa.DateTime(timezone=True)))
    for name in ("acknowledged_by", "departed_by"):
        op.add_column("dispatch_records", sa.Column(name, sa.Integer()))
        op.create_foreign_key(f"fk_response_{name}", "dispatch_records", "users",
                              [name], ["user_id"], ondelete="SET NULL")
    op.add_column("dispatch_records", sa.Column("context_snapshot", JSONB()))
    op.create_index("ix_response_dispatch_time_team", "dispatch_records", ["dispatch_at", "team_id"])
    op.create_check_constraint("ck_response_dispatch_order", "dispatch_records",
        "(acknowledged_at IS NULL OR acknowledged_at >= dispatch_at) AND "
        "(departed_at IS NULL OR departed_at >= dispatch_at) AND "
        "(departed_at IS NULL OR acknowledged_at IS NULL OR departed_at >= acknowledged_at)")
    # Preserve only routes still available now. This is an explicitly marked
    # migration-time snapshot; never reconstruct a deleted historical route.
    op.execute("""INSERT INTO incident_events
        (fire_id,event_type,created_at,occurred_at,source,verified,dispatch_id,idempotency_key,event_metadata)
        SELECT d.fire_id, 'op_routes', now(), now(), 'migration_legacy', false, d.dispatch_id,
          'migration0028:routes:' || d.dispatch_id,
          jsonb_build_object('selected_route_id', d.route_id, 'selection_reason', 'legacy_at_migration',
            'provenance', 'current_routes_at_migration', 'routes',
            jsonb_agg(jsonb_build_object('route_id', r.route_id, 'rank', r.route_rank,
              'wkt', r.route_path_geojson, 'distance_meters', r.route_distance_meters,
              'eta_seconds', r.route_est_minutes * 60,
              'origin', CASE WHEN r.route_origin_lat IS NOT NULL AND r.route_origin_lng IS NOT NULL
                THEN jsonb_build_array(r.route_origin_lat, r.route_origin_lng) ELSE NULL END,
              'origin_source', r.route_origin_source) ORDER BY r.route_rank, r.route_id))
        FROM dispatch_records d JOIN routes r ON r.dispatch_id=d.dispatch_id
        WHERE d.route_id IS NOT NULL GROUP BY d.dispatch_id""")


def downgrade():
    op.execute("DELETE FROM incident_events WHERE idempotency_key LIKE 'migration0028:routes:%'")
    op.drop_index("ix_response_location_dispatch_time", table_name="dispatch_locations")
    op.drop_table("dispatch_locations")
    op.drop_index("ix_response_unit_sample_time", table_name="truck_logs")
    op.drop_constraint("fk_response_log_personnel", "truck_logs", type_="foreignkey")
    op.drop_column("truck_logs", "per_id")
    op.drop_constraint("ck_response_dispatch_order", "dispatch_records", type_="check")
    op.drop_index("ix_response_dispatch_time_team", table_name="dispatch_records")
    op.drop_column("dispatch_records", "context_snapshot")
    for name in ("departed_by", "acknowledged_by"):
        op.drop_constraint(f"fk_response_{name}", "dispatch_records", type_="foreignkey")
        op.drop_column("dispatch_records", name)
    for name in ("departed_at", "acknowledged_at"):
        op.drop_column("dispatch_records", name)
    op.drop_constraint("ck_response_record_kind", "fire_incidents", type_="check")
    op.drop_column("fire_incidents", "record_kind")
    op.drop_column("fire_incidents", "created_at")
