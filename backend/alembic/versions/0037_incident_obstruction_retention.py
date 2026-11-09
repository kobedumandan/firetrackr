"""Preserve archived incidents and resolved road obstructions."""
from alembic import op
import sqlalchemy as sa

revision = '0037'
down_revision = '0036'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('fire_incidents', sa.Column('archived_at', sa.DateTime(timezone=True)))
    op.add_column('fire_incidents', sa.Column('archived_by', sa.Integer()))
    op.create_index('ix_fire_incidents_archived_at', 'fire_incidents', ['archived_at'])
    op.create_foreign_key('fk_fire_incidents_archived_by', 'fire_incidents', 'users', ['archived_by'], ['user_id'], ondelete='SET NULL')
    op.add_column('road_obstructions', sa.Column('resolved_at', sa.DateTime(timezone=True)))
    op.add_column('road_obstructions', sa.Column('resolved_by', sa.Integer()))
    op.add_column('road_obstructions', sa.Column('resolution_note', sa.String(500)))
    op.create_foreign_key('fk_obstructions_resolved_by', 'road_obstructions', 'users', ['resolved_by'], ['user_id'], ondelete='SET NULL')


def downgrade():
    connection = op.get_bind()
    if connection.execute(sa.text('SELECT EXISTS (SELECT 1 FROM fire_incidents WHERE archived_at IS NOT NULL) OR EXISTS (SELECT 1 FROM road_obstructions WHERE resolved_at IS NOT NULL)')).scalar():
        raise RuntimeError('Archive/resolution history exists; preserve lifecycle columns.')
    op.drop_constraint('fk_obstructions_resolved_by', 'road_obstructions', type_='foreignkey')
    for name in ('resolution_note', 'resolved_by', 'resolved_at'):
        op.drop_column('road_obstructions', name)
    op.drop_constraint('fk_fire_incidents_archived_by', 'fire_incidents', type_='foreignkey')
    op.drop_index('ix_fire_incidents_archived_at', 'fire_incidents')
    op.drop_column('fire_incidents', 'archived_by')
    op.drop_column('fire_incidents', 'archived_at')
