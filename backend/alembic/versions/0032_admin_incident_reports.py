"""Allow administrators to author after-action reports without personnel rows."""
from alembic import op
import sqlalchemy as sa

revision = '0032'
down_revision = '0031'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column('incident_reports', 'per_id', existing_type=sa.Integer(), nullable=True)
    op.add_column('incident_reports', sa.Column('author_user_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_incident_reports_author_user', 'incident_reports', 'users',
                          ['author_user_id'], ['user_id'], ondelete='SET NULL')
    op.alter_column('fire_incidents', 'fire_casualties', existing_type=sa.String(100), type_=sa.String(255))


def downgrade():
    connection = op.get_bind()
    if connection.execute(sa.text('SELECT EXISTS (SELECT 1 FROM incident_reports WHERE per_id IS NULL)')).scalar():
        raise RuntimeError('Cannot downgrade while administrator-authored reports exist; preserve their author records.')
    if connection.execute(sa.text('SELECT EXISTS (SELECT 1 FROM fire_incidents WHERE length(fire_casualties) > 100)')).scalar():
        raise RuntimeError('Cannot shorten casualty summaries without losing saved report data.')
    op.alter_column('fire_incidents', 'fire_casualties', existing_type=sa.String(255), type_=sa.String(100))
    op.drop_constraint('fk_incident_reports_author_user', 'incident_reports', type_='foreignkey')
    op.drop_column('incident_reports', 'author_user_id')
    op.alter_column('incident_reports', 'per_id', existing_type=sa.Integer(), nullable=False)
