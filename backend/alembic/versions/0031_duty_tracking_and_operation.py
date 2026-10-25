"""Attributed standby fixes and independently recorded operation endpoints."""
from alembic import op
import sqlalchemy as sa

revision = '0031'
down_revision = '0030'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('location_logs', sa.Column('per_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_location_logs_personnel', 'location_logs', 'personnel', ['per_id'], ['per_id'], ondelete='SET NULL')
    op.add_column('location_logs', sa.Column('recorded_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('location_logs', sa.Column('accuracy_m', sa.Float(), nullable=True))
    op.add_column('location_logs', sa.Column('collection_mode', sa.String(20), nullable=True))
    op.add_column('location_logs', sa.Column('sample_key', sa.String(160), nullable=True))
    op.create_index('ix_location_logs_per_id_recorded', 'location_logs', ['per_id', 'recorded_at'])
    op.create_index('uq_location_logs_sample_key', 'location_logs', ['sample_key'], unique=True)
    op.add_column('fire_incidents', sa.Column('operation_completed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('dispatch_records', sa.Column('cleared_at', sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column('dispatch_records', 'cleared_at')
    op.drop_column('fire_incidents', 'operation_completed_at')
    op.drop_index('uq_location_logs_sample_key', table_name='location_logs')
    op.drop_index('ix_location_logs_per_id_recorded', table_name='location_logs')
    op.drop_constraint('fk_location_logs_personnel', 'location_logs', type_='foreignkey')
    for name in ('sample_key', 'collection_mode', 'accuracy_m', 'recorded_at', 'per_id'):
        op.drop_column('location_logs', name)
