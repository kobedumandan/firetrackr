"""Retain legacy dispatch attribution already present in the original database."""
from alembic import op
import sqlalchemy as sa

revision = '0033'
down_revision = '0032'
branch_labels = None
depends_on = None

LEGACY_FIELDS = {
    'dispatch_arrived_by': 20,
    'dispatch_arrived_by_name': 150,
    'dispatch_recalled_by': 150,
}


def upgrade():
    connection = op.get_bind()
    columns = {column['name']: column for column in sa.inspect(connection).get_columns('dispatch_records')}
    for name, length in LEGACY_FIELDS.items():
        if name in columns:
            column = columns[name]
            if (not isinstance(column['type'], sa.String) or column['type'].length != length
                    or not column['nullable']):
                raise RuntimeError('Existing legacy dispatch attribution has an unexpected definition; preserve it for review.')
        else:
            op.add_column('dispatch_records', sa.Column(name, sa.String(length), nullable=True))


def downgrade():
    connection = op.get_bind()
    has_history = connection.execute(sa.text('''
        SELECT EXISTS (
            SELECT 1 FROM dispatch_records
            WHERE dispatch_arrived_by IS NOT NULL
               OR dispatch_arrived_by_name IS NOT NULL
               OR dispatch_recalled_by IS NOT NULL
        )
    ''')).scalar()
    if has_history:
        raise RuntimeError('Cannot drop legacy dispatch attribution while historical values exist; preserve the records.')
    for name in reversed(LEGACY_FIELDS):
        op.drop_column('dispatch_records', name)
