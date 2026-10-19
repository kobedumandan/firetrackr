"""Add an optional dispatch category to incidents.

Revision ID: 0024
Revises: 0023
"""
from alembic import op
import sqlalchemy as sa

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Keep existing records unspecified rather than guessing their category.
    op.add_column("fire_incidents", sa.Column("fire_dispatch_type", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("fire_incidents", "fire_dispatch_type")
