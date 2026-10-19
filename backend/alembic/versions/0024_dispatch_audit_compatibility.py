"""Reconstruct missing 0024 from the supplied October 19 PostgreSQL schema.

This is a compatibility reconstruction, not the original migration source.
The supplied dump and local database are already at 0024 and have these three
nullable columns. A fresh 0023 database needs the same shape. No data is backfilled.
"""
from alembic import op
import sqlalchemy as sa

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("dispatch_records", sa.Column("dispatch_arrived_by", sa.String(20)))
    op.add_column("dispatch_records", sa.Column("dispatch_arrived_by_name", sa.String(150)))
    op.add_column("dispatch_records", sa.Column("dispatch_recalled_by", sa.String(150)))


def downgrade():
    for name in ("dispatch_recalled_by", "dispatch_arrived_by_name", "dispatch_arrived_by"):
        op.drop_column("dispatch_records", name)
