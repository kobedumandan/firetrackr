"""Separate clearance, truck readiness and dispatcher report review.

Historical timestamps and report ownership remain unknown unless already recorded.
"""
from alembic import op
import sqlalchemy as sa

revision = '0034'
down_revision = '0033'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('truck', sa.Column('readiness_note', sa.String(255)))
    op.add_column('truck', sa.Column('readiness_confirmed_at', sa.DateTime(timezone=True)))
    op.add_column('truck', sa.Column('readiness_confirmed_by', sa.Integer()))
    op.create_foreign_key('fk_truck_readiness_user', 'truck', 'users', ['readiness_confirmed_by'], ['user_id'], ondelete='SET NULL')
    op.add_column('fire_incidents', sa.Column('casualties_reviewed_at', sa.DateTime(timezone=True)))
    op.add_column('dispatch_records', sa.Column('release_authorized_at', sa.DateTime(timezone=True)))
    op.add_column('dispatch_records', sa.Column('release_authorized_by', sa.Integer()))
    op.create_foreign_key('fk_dispatch_release_user', 'dispatch_records', 'users', ['release_authorized_by'], ['user_id'], ondelete='SET NULL')
    for name in ('return_started_at', 'returned_at', 'ready_at'):
        op.add_column('dispatch_trucks', sa.Column(name, sa.DateTime(timezone=True)))
    op.add_column('dispatch_trucks', sa.Column('return_driver_per_id', sa.Integer()))
    op.add_column('dispatch_trucks', sa.Column('return_station_id', sa.Integer()))
    op.add_column('dispatch_trucks', sa.Column('not_ready_reason', sa.String(255)))
    op.create_foreign_key('fk_return_driver', 'dispatch_trucks', 'personnel', ['return_driver_per_id'], ['per_id'], ondelete='SET NULL')
    op.create_foreign_key('fk_return_station', 'dispatch_trucks', 'stations', ['return_station_id'], ['station_id'], ondelete='SET NULL')
    op.create_index('ix_dispatch_truck_return', 'dispatch_trucks', ['truck_id', 'return_started_at', 'ready_at'])
    op.add_column('incident_reports', sa.Column('report_kind', sa.String(20), nullable=False, server_default='legacy'))
    op.add_column('incident_reports', sa.Column('reviewed_at', sa.DateTime(timezone=True)))
    op.add_column('incident_reports', sa.Column('reviewed_by_user_id', sa.Integer()))
    op.add_column('incident_reports', sa.Column('revision', sa.Integer(), nullable=False, server_default='1'))
    op.create_foreign_key('fk_report_review_user', 'incident_reports', 'users', ['reviewed_by_user_id'], ['user_id'], ondelete='SET NULL')
    op.create_index('ix_report_incident_kind', 'incident_reports', ['fire_id', 'report_kind'])


def downgrade():
    op.drop_constraint('fk_truck_readiness_user', 'truck', type_='foreignkey')
    for name in ('readiness_confirmed_by', 'readiness_confirmed_at', 'readiness_note'):
        op.drop_column('truck', name)
    op.drop_index('ix_report_incident_kind', table_name='incident_reports')
    op.drop_constraint('fk_report_review_user', 'incident_reports', type_='foreignkey')
    for name in ('revision', 'reviewed_by_user_id', 'reviewed_at', 'report_kind'):
        op.drop_column('incident_reports', name)
    op.drop_index('ix_dispatch_truck_return', table_name='dispatch_trucks')
    op.drop_constraint('fk_return_station', 'dispatch_trucks', type_='foreignkey')
    op.drop_constraint('fk_return_driver', 'dispatch_trucks', type_='foreignkey')
    for name in ('not_ready_reason', 'return_station_id', 'return_driver_per_id', 'ready_at', 'returned_at', 'return_started_at'):
        op.drop_column('dispatch_trucks', name)
    op.drop_constraint('fk_dispatch_release_user', 'dispatch_records', type_='foreignkey')
    op.drop_column('dispatch_records', 'release_authorized_by')
    op.drop_column('dispatch_records', 'release_authorized_at')
    op.drop_column('fire_incidents', 'casualties_reviewed_at')
