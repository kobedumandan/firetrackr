"""Add optional narrow severity and recurring traffic windows; preserve legacy rows."""
from alembic import op
import sqlalchemy as sa

revision = '0029'
down_revision = '0028'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('gnn_constraints', sa.Column('narrow_severity', sa.String(10), nullable=True))
    op.add_column('gnn_constraints', sa.Column('traffic_schedule', sa.JSON(), nullable=True))
    op.create_check_constraint('ck_constraint_narrow_severity', 'gnn_constraints', "narrow_severity IN ('slight', 'severe')")


def downgrade():
    op.drop_constraint('ck_constraint_narrow_severity', 'gnn_constraints', type_='check')
    op.drop_column('gnn_constraints', 'traffic_schedule')
    op.drop_column('gnn_constraints', 'narrow_severity')
