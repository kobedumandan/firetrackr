"""Persist stable road-segment identities on drawn constraints.

Revision ID: 0025
Revises: 0024
"""
from alembic import op
import sqlalchemy as sa

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade():
    # NULL means legacy/unresolved; [] means snapping found no covered segment.
    # Legacy records are resolved in memory until explicitly edited.
    op.add_column("gnn_constraints", sa.Column("segment_uids", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("gnn_constraints", "segment_uids")
