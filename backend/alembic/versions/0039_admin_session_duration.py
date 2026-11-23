"""Record administrator session lifetimes without fabricating historical durations."""
from alembic import op
import sqlalchemy as sa

revision = '0039'
down_revision = '0038'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'admin_sessions',
        sa.Column('session_id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.user_id', ondelete='CASCADE'), nullable=False),
        sa.Column('login_id', sa.Integer(), sa.ForeignKey('login_history.login_id', ondelete='SET NULL'), unique=True),
        sa.Column('jti', sa.String(64), nullable=False, unique=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('ended_at', sa.DateTime(timezone=True)),
    )
    op.create_index('ix_admin_sessions_user_start', 'admin_sessions', ['user_id', 'started_at'])


def downgrade():
    op.drop_index('ix_admin_sessions_user_start', table_name='admin_sessions')
    op.drop_table('admin_sessions')
