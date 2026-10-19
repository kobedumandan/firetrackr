"""Reconcile databases upgraded through the pre-merge feature migration chain.

Revision ID: 0026
Revises: 0025

The feature branch previously used revision 0024 for a reconstructed schema
placeholder. Main later supplied the authoritative 0024, which adds
fire_dispatch_type. Databases already stamped at feature revision 0025 therefore
need this guarded repair; fresh databases already received the column from 0024.
"""
from alembic import op
import sqlalchemy as sa

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None

_TABLE = "fire_incidents"
_COLUMN = "fire_dispatch_type"
_MARKER = "Added by FireTrackr migration 0026 compatibility repair"


def _column():
    return next(
        (column for column in sa.inspect(op.get_bind()).get_columns(_TABLE) if column["name"] == _COLUMN),
        None,
    )


def upgrade() -> None:
    if _column() is None:
        op.add_column(
            _TABLE,
            sa.Column(_COLUMN, sa.String(100), nullable=True, comment=_MARKER),
        )


def downgrade() -> None:
    column = _column()
    # Preserve the authoritative 0024 column. Only undo the compatibility
    # repair when this migration itself created it.
    if column is not None and column.get("comment") == _MARKER:
        op.drop_column(_TABLE, _COLUMN)
