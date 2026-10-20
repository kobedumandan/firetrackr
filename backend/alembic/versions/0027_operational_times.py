"""Operational milestones after the existing constraint/model registry chain.

New web revision 0027; preserves already-applied original 0025/0026 history.
No historical timestamp backfill.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None

COLUMNS = {
    "fire_incidents": [
        sa.Column("report_received_at", sa.DateTime(timezone=True)),
        sa.Column("suppression_started_at", sa.DateTime(timezone=True)),
        sa.Column("fire_out_at", sa.DateTime(timezone=True)),
        sa.Column("response_kind", sa.String(20)),
    ],
    "dispatch_trucks": [sa.Column(n, sa.DateTime(timezone=True)) for n in ("departed_at", "arrived_at")],
    "incident_events": [
        sa.Column("occurred_at", sa.DateTime(timezone=True)), sa.Column("source", sa.String(30)),
        sa.Column("verified", sa.Boolean()), sa.Column("dispatch_id", sa.Integer()),
        sa.Column("dispatch_truck_id", sa.Integer()), sa.Column("idempotency_key", sa.String(160)),
        sa.Column("event_metadata", JSONB()),
    ],
    "truck_logs": [
        sa.Column("dispatch_truck_id", sa.Integer()), sa.Column("accuracy_m", sa.Float()),
        sa.Column("received_at", sa.DateTime(timezone=True)), sa.Column("source", sa.String(30)),
        sa.Column("sample_key", sa.String(160)),
    ],
}
INDEXES = [("fire_incidents", "report_received_at"), ("incident_events", "dispatch_id"),
           ("incident_events", "dispatch_truck_id"), ("truck_logs", "dispatch_truck_id")]
FKS = [("incident_events", "dispatch_id", "dispatch_records", "dispatch_id"),
       ("incident_events", "dispatch_truck_id", "dispatch_trucks", "dispatch_truck_id"),
       ("truck_logs", "dispatch_truck_id", "dispatch_trucks", "dispatch_truck_id")]


def upgrade():
    for table, columns in COLUMNS.items():
        for column in columns:
            op.add_column(table, column)
    for table, column in INDEXES:
        op.create_index(f"ix_{table}_{column}", table, [column])
    for table, column, target, key in FKS:
        op.create_foreign_key(f"fk_ops_{table}_{column}", table, target, [column], [key], ondelete="SET NULL")
    op.create_unique_constraint("uq_ops_event_key", "incident_events", ["idempotency_key"])
    op.create_unique_constraint("uq_ops_sample_key", "truck_logs", ["sample_key"])
    op.create_check_constraint("ck_ops_unit_order", "dispatch_trucks", "arrived_at IS NULL OR departed_at IS NULL OR arrived_at >= departed_at")
    op.create_check_constraint("ck_ops_suppression_order", "fire_incidents", "fire_out_at IS NULL OR suppression_started_at IS NULL OR fire_out_at >= suppression_started_at")
    op.create_check_constraint("ck_ops_kind", "fire_incidents", "response_kind IN ('fire', 'medical', 'rescue', 'other')")


def downgrade():
    op.drop_constraint("ck_ops_kind", "fire_incidents")
    op.drop_constraint("ck_ops_suppression_order", "fire_incidents")
    op.drop_constraint("ck_ops_unit_order", "dispatch_trucks")
    op.drop_constraint("uq_ops_sample_key", "truck_logs")
    op.drop_constraint("uq_ops_event_key", "incident_events")
    for table, column, _, _ in reversed(FKS):
        op.drop_constraint(f"fk_ops_{table}_{column}", table, type_="foreignkey")
    for table, column in reversed(INDEXES):
        op.drop_index(f"ix_{table}_{column}", table)
    for table, columns in reversed(list(COLUMNS.items())):
        for column in reversed(columns):
            op.drop_column(table, column.name)
