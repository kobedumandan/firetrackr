"""Display dispatch evidence without following mutable resource assignments.

Missing legacy evidence stays unknown. Migration 0038 freezes available metadata,
explicitly identifying it as a baseline rather than verified assignment evidence.
"""


def assignment_context(team, members, at):
    from services.personnel_deployment import member_snapshot

    station, truck = team.station, team.truck
    return {
        'provenance': 'assignment', 'snapshot_version': 2,
        'team_name': team.team_name, 'team_code': team.team_code,
        'station_id': team.station_id,
        'station_name': station.station_name if station else None,
        'station_latitude': station.station_latitude if station else None,
        'station_longitude': station.station_longitude if station else None,
        'shift_name': team.shift.shift_name if team.shift else None,
        'truck_id': team.truck_id, 'truck': truck.truck_platenum if truck else None,
        'trucks': [{'truck_id': truck.truck_id, 'plate': truck.truck_platenum}] if truck else [],
        'roster': [member_snapshot(member, at) for member in members],
    }


def context(dispatch):
    defaults = dict.fromkeys(('team_name', 'team_code', 'station_id', 'station_name',
                              'station_latitude', 'station_longitude', 'shift_name', 'truck_id', 'truck'))
    return {**defaults, 'provenance': 'legacy_unknown', **(dispatch.context_snapshot or {})}


def truck_plate(dispatch, truck_id):
    saved = context(dispatch)
    if saved.get('truck_id') == truck_id and 'truck' in saved:
        return saved['truck']
    return next((t.get('plate') for t in saved.get('trucks', [])
                 if t.get('truck_id') == truck_id), None)


def members(dispatch):
    """Include everyone recorded in this response, including released members."""
    saved = context(dispatch)
    result = {}
    for row in saved.get('roster', saved.get('legacy_display_members', [])):
        name = row.get('name') or f"Responder #{row['per_id']}"
        result.setdefault(row['per_id'], {
            'per_id': row['per_id'], 'name': name, 'rank': row.get('rank'),
            'designation': row.get('designation'), 'member_role': row.get('role'),
            'initials': ''.join(part[0].upper() for part in name.split()[:2]),
        })
    return list(result.values())
