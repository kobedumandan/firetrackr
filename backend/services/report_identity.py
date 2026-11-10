"""Capture authors at insertion, including reports written by import tools."""
from sqlalchemy import text


def author_snapshot(context):
    values = context.get_current_parameters()
    if values.get('per_id') is not None:
        row = context.connection.execute(text("""
            SELECT trim(concat(per_firstname, ' ', per_lastname)) AS name,
                   per_rank AS rank FROM personnel WHERE per_id = :id
        """), {'id': values['per_id']}).mappings().first()
        role = 'personnel'
    elif values.get('author_user_id') is not None:
        row = context.connection.execute(text("""
            SELECT COALESCE(NULLIF(trim(concat(a.admin_firstname, ' ', a.admin_lastname)), ''),
                            u.user_email) AS name, 'Administrator' AS rank
            FROM users u LEFT JOIN admin a ON a.user_id = u.user_id WHERE u.user_id = :id
        """), {'id': values['author_user_id']}).mappings().first()
        role = 'admin'
    else:
        return {'name': None, 'rank': None, 'role': None, 'provenance': 'unknown'}
    return {**dict(row or {}), 'role': role, 'provenance': 'submission'}
