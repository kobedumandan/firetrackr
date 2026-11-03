"""Administrator report recovery and correction, preserving field attribution."""
from datetime import datetime, timezone
from io import BytesIO
from uuid import uuid4
import warnings

from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError
from sqlalchemy import func
from starlette.concurrency import run_in_threadpool

from config import MAX_PHOTO_BYTES, MAX_REPORT_PHOTOS
from models import DispatchRecord, FireIncident, IncidentEvent, IncidentReport, ReportPhoto
from services.dispatch import _add_incident_to_heatmap, _complete_dispatch_and_release, _released_payload
from services.incident_events import record_changes, snapshot
from services.operational_times import audit, iso
from services.report_timing import timeline
from services.report_photos import save_report_photo


REPORT_FIELDS = {
    'cause': 'report_cause',
    'casualties': 'report_casualties',
    'damage_estimate': 'report_damage_estimate',
    'narrative': 'report_narrative',
    'recommendations': 'report_recommendations',
}
ADMIN_PHOTO_FORMATS = {
    'image/jpeg': ('JPEG', '.jpg'),
    'image/jpg': ('JPEG', '.jpg'),
    'image/png': ('PNG', '.png'),
    'image/webp': ('WEBP', '.webp'),
}


def _verify_admin_photo(data, content_type):
    """Validate image contents before storing a browser attachment."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                if image.format != ADMIN_PHOTO_FORMATS[content_type][0]:
                    raise ValueError('Photo contents do not match its type.')
                image.verify()
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError,
            Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(422, 'Each attachment must be a valid JPG, PNG or WebP image.') from None


async def append_admin_report_photos(db, report, photos, written_names):
    """Append inside the locked report transaction; the caller owns compensation."""
    if not photos:
        return
    if len(report.photos) + len(photos) > MAX_REPORT_PHOTOS:
        raise HTTPException(422, f'A report can have at most {MAX_REPORT_PHOTOS} photos, including existing photos.')
    for photo in photos:
        content_type = (photo.content_type or '').lower()
        if content_type not in ADMIN_PHOTO_FORMATS:
            raise HTTPException(422, 'Choose JPG, PNG or WebP photos.')
        if len(photo.filename) > 255:
            raise HTTPException(422, 'Photo filenames must be no longer than 255 characters.')
    for photo in photos:
        content_type = photo.content_type.lower()
        data = await photo.read(MAX_PHOTO_BYTES + 1)
        if not data or len(data) > MAX_PHOTO_BYTES:
            raise HTTPException(422, 'Each photo must be nonempty and no larger than 10 MB.')
        await run_in_threadpool(_verify_admin_photo, data, content_type)
        name = f'report{report.report_id}_{uuid4().hex}{ADMIN_PHOTO_FORMATS[content_type][1]}'
        await run_in_threadpool(save_report_photo, name, data, content_type)
        written_names.append(name)
        report.photos.append(ReportPhoto(file_name=name, original_name=photo.filename,
                                         content_type=content_type))
    db.flush()


def report_closed_at(db, report):
    """A late recovery report must not move the incident's original closure."""
    closed = (db.query(IncidentEvent)
              .filter_by(fire_id=report.fire_id, event_type='status', event_to='closed')
              .order_by(func.coalesce(IncidentEvent.occurred_at, IncidentEvent.created_at), IncidentEvent.event_id)
              .first())
    if closed:
        return iso(closed.occurred_at or closed.created_at)
    # Legacy team-leader submission itself closed the incident. Administrator
    # recovery can happen later, so its submission cannot establish this clock.
    return iso(report.report_submitted_at) if report.per_id is not None else None


def save_admin_report(db, fire_id, body, user, *, photos_added=0):
    """Lock and save within the caller's transaction; never rewrite event times."""
    if user.user_role != 'admin':
        raise HTTPException(403, 'Admin access required')
    inc = db.query(FireIncident).filter_by(fire_id=fire_id).populate_existing().with_for_update().first()
    if not inc:
        raise HTTPException(404, 'Incident not found.')
    if inc.fire_status not in ('contained', 'closed'):
        raise HTTPException(409, 'The incident must be contained or closed before filing an after-action report.')
    report = (db.query(IncidentReport).filter_by(fire_id=fire_id)
              .order_by(IncidentReport.report_submitted_at.desc(), IncidentReport.report_id.desc())
              .populate_existing().with_for_update().first())
    if (report is None) != (body.report_id is None) or (report and report.report_id != body.report_id):
        raise HTTPException(409, 'The report has changed. Reload the incident before saving your changes.')

    now = datetime.now(timezone.utc)
    creating = report is None
    if creating:
        report = IncidentReport(fire_id=fire_id, per_id=None, author_user_id=user.user_id,
                                report_submitted_at=now)
        db.add(report)
    before = {key: getattr(report, column) for key, column in REPORT_FIELDS.items()}
    outcome_before = {'casualties': inc.fire_casualties, 'remarks': inc.fire_remarks}
    values = body.model_dump(exclude_unset=True)
    for key, column in REPORT_FIELDS.items():
        if key in values:
            setattr(report, column, values[key])
    if 'casualties' in values:
        inc.fire_casualties = body.casualties
    if 'remarks' in values:
        inc.fire_remarks = body.remarks
    db.flush()
    after = {key: getattr(report, column) for key, column in REPORT_FIELDS.items()}
    audit(db, inc, 'report_created' if creating else 'report_edited', now, user,
          source='admin_report', metadata={
              'report_id': report.report_id,
              'photos_added': photos_added,
              'changes': {key: {'before': before[key], 'after': value}
                          for key, value in after.items() if before[key] != value},
              'outcome_changes': {key: {'before': outcome_before[key], 'after': value}
                                  for key, value in {'casualties': inc.fire_casualties, 'remarks': inc.fire_remarks}.items()
                                  if outcome_before[key] != value},
          })
    if creating:
        # Capture known evidence only. Filing does not establish operational times.
        audit(db, inc, 'op_report_timing', now, user, source='admin_report',
              metadata={'report_id': report.report_id, 'timeline': timeline(db, inc)})

    released = None
    if inc.fire_status == 'contained':
        incident_before = snapshot(inc)
        inc.fire_status = 'closed'
        record_changes(db, inc, incident_before, user=user, at=now)
        active = db.query(DispatchRecord).filter(
            DispatchRecord.fire_id == fire_id,
            DispatchRecord.dispatch_status.in_(('dispatched', 'en_route', 'on_scene')),
        ).all()
        for dispatch in active:
            _complete_dispatch_and_release(dispatch, now)
        _add_incident_to_heatmap(db, inc, now)
        released = _released_payload(active) if active else None
    return report, inc, released, creating
