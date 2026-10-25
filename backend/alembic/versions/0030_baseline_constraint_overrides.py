"""Distinguish reversible baseline corrections from additive road annotations."""
from alembic import op
import sqlalchemy as sa

revision = '0030'
down_revision = '0029'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('gnn_constraints', sa.Column('baseline_segment_uid', sa.String(255), nullable=True))
    op.create_index('uq_active_baseline_override', 'gnn_constraints', ['baseline_segment_uid'],
                    unique=True, postgresql_where=sa.text('is_active AND baseline_segment_uid IS NOT NULL'),
                    sqlite_where=sa.text('is_active AND baseline_segment_uid IS NOT NULL'))


def downgrade():
    op.drop_index('uq_active_baseline_override', table_name='gnn_constraints')
    op.drop_column('gnn_constraints', 'baseline_segment_uid')
