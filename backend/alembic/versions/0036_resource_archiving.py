"""Resource retirement and account access lifecycle."""
from alembic import op
import sqlalchemy as sa

revision = '0036'
down_revision = '0035'
branch_labels = None
depends_on = None

TABLES = ('response_teams', 'truck', 'personnel', 'stations')


def upgrade():
    for table in TABLES:
        op.add_column(table, sa.Column('archived_at', sa.DateTime(timezone=True)))
        op.add_column(table, sa.Column('archived_by', sa.Integer()))
        op.create_index(f'ix_{table}_archived_at', table, ['archived_at'])
        op.create_foreign_key(f'fk_{table}_archived_by', table, 'users', ['archived_by'], ['user_id'], ondelete='SET NULL')
    for name in ('disabled_at', 'sessions_revoked_at'):
        op.add_column('users', sa.Column(name, sa.DateTime(timezone=True)))
    op.add_column('users', sa.Column('disabled_by', sa.Integer()))
    op.create_foreign_key('fk_users_disabled_by', 'users', 'users', ['disabled_by'], ['user_id'], ondelete='SET NULL')


def downgrade():
    connection = op.get_bind()
    for table in TABLES:
        if connection.execute(sa.text(f'SELECT EXISTS (SELECT 1 FROM {table} WHERE archived_at IS NOT NULL)')).scalar():
            raise RuntimeError('Restore archived resources before removing lifecycle columns.')
    if connection.execute(sa.text('SELECT EXISTS (SELECT 1 FROM users WHERE disabled_at IS NOT NULL OR sessions_revoked_at IS NOT NULL)')).scalar():
        raise RuntimeError('Account access history exists; preserve lifecycle columns.')
    op.drop_constraint('fk_users_disabled_by', 'users', type_='foreignkey')
    for name in ('disabled_by', 'sessions_revoked_at', 'disabled_at'):
        op.drop_column('users', name)
    for table in reversed(TABLES):
        op.drop_constraint(f'fk_{table}_archived_by', table, type_='foreignkey')
        op.drop_index(f'ix_{table}_archived_at', table)
        op.drop_column(table, 'archived_by')
        op.drop_column(table, 'archived_at')
