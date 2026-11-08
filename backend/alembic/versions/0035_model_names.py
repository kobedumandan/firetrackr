"""Add optional display names to model versions."""
from alembic import op
import sqlalchemy as sa

revision = '0035'
down_revision = '0034'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('model_versions', sa.Column('name', sa.String(120), nullable=True))


def downgrade():
    op.drop_column('model_versions', 'name')
