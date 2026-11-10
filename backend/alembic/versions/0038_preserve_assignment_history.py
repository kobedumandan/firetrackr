"""Freeze resource display metadata without inventing legacy deployment evidence."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '0038'
down_revision = '0037'
branch_labels = None
depends_on = None


def upgrade():
    # Preserve existing snapshot keys, including explicit nulls and empty rosters.
    # Missing fields are only today's metadata, never evidence of past attendance.
    op.execute("""
        UPDATE dispatch_records d SET context_snapshot =
          jsonb_build_object(
            'provenance', 'legacy_frozen_metadata',
            'metadata_provenance', 'migration_current_metadata',
            'metadata_frozen_at', CURRENT_TIMESTAMP,
            'team_name', t.team_name, 'team_code', t.team_code,
            'station_id', t.station_id, 'station_name', s.station_name,
            'station_latitude', s.station_latitude, 'station_longitude', s.station_longitude,
            'shift_name', sh.shift_name,
            'truck_id', t.truck_id, 'truck', tr.truck_platenum,
            'return_stations', COALESCE((SELECT jsonb_object_agg(dt.truck_id::text,
                jsonb_build_object('name', rs.station_name,
                    'latitude', rs.station_latitude, 'longitude', rs.station_longitude))
                FROM dispatch_trucks dt LEFT JOIN stations rs ON rs.station_id = dt.return_station_id
                WHERE dt.dispatch_id = d.dispatch_id AND dt.return_started_at IS NOT NULL), '{}'::jsonb),
            'recorded_personnel', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'per_id', p.per_id, 'name', trim(concat(p.per_firstname, ' ', p.per_lastname)), 'rank', p.per_rank))
                FROM personnel p WHERE p.per_id IN (SELECT dl.per_id FROM dispatch_locations dl
                WHERE dl.dispatch_id = d.dispatch_id)), '[]'::jsonb),
            'trucks', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'truck_id', dt.truck_id, 'plate', v.truck_platenum) ORDER BY dt.dispatch_truck_id)
                FROM dispatch_trucks dt LEFT JOIN truck v ON v.truck_id = dt.truck_id
                WHERE dt.dispatch_id = d.dispatch_id), '[]'::jsonb),
            'legacy_display_members', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'per_id', m.per_id, 'name', trim(concat(p.per_firstname, ' ', p.per_lastname)),
                'rank', p.per_rank, 'designation', p.per_designation, 'role', m.member_role)
                ORDER BY m.members_id)
                FROM response_team_members m JOIN personnel p ON p.per_id = m.per_id
                WHERE m.team_id = d.team_id), '[]'::jsonb)
          ) || CASE WHEN jsonb_typeof(d.context_snapshot) = 'object'
                    THEN d.context_snapshot ELSE '{}'::jsonb END
        FROM response_teams t
        LEFT JOIN stations s ON s.station_id = t.station_id
        LEFT JOIN shifts sh ON sh.shift_id = t.shift_id
        LEFT JOIN truck tr ON tr.truck_id = t.truck_id
        WHERE t.team_id = d.team_id
    """)
    op.add_column('incident_reports', sa.Column('author_snapshot', JSONB()))
    op.execute("""
        UPDATE incident_reports r SET author_snapshot = json_build_object(
            'name', trim(concat(p.per_firstname, ' ', p.per_lastname)),
            'rank', p.per_rank, 'role', 'personnel', 'provenance', 'migration_current_metadata')
        FROM personnel p WHERE p.per_id = r.per_id
    """)
    op.execute("""
        UPDATE incident_reports r SET author_snapshot = json_build_object(
            'name', COALESCE(NULLIF(trim(concat(a.admin_firstname, ' ', a.admin_lastname)), ''), u.user_email),
            'rank', 'Administrator', 'role', 'admin',
            'provenance', 'migration_current_metadata')
        FROM users u LEFT JOIN admin a ON a.user_id = u.user_id
        WHERE u.user_id = r.author_user_id AND r.per_id IS NULL
    """)


def downgrade():
    # Frozen dispatch JSON remains useful to older readers; never erase evidence.
    op.drop_column('incident_reports', 'author_snapshot')
