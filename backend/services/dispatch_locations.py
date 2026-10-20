"""Store membership-checked samples without inferring vehicle occupancy."""
from datetime import datetime, timedelta, timezone
from math import isfinite

from sqlalchemy.dialects.postgresql import insert

from models import DispatchLocation


def collect(db, dispatch, per_id, latitude, longitude, at, accuracy=None, sample_id=None):
    now = datetime.now(timezone.utc)
    if (at.tzinfo is None or at > now + timedelta(seconds=30) or not dispatch.dispatch_at
            or at < dispatch.dispatch_at or not all(isfinite(v) for v in (latitude, longitude))
            or not (-90 <= latitude <= 90 and -180 <= longitude <= 180)):
        return
    if accuracy is not None and (not isfinite(accuracy) or accuracy < 0):
        return
    units = [u for u in dispatch.dispatch_trucks if u.manned_by_per_id == per_id
             and u.manned_since and at >= u.manned_since]
    db.execute(insert(DispatchLocation).values(
        dispatch_id=dispatch.dispatch_id, per_id=per_id,
        truck_id=units[0].truck_id if len(units) == 1 else None,
        recorded_at=at, received_at=now, latitude=latitude, longitude=longitude,
        accuracy_m=accuracy, source="mobile_app",
        sample_key=f"location:{dispatch.dispatch_id}:{per_id}:{sample_id or at.astimezone(timezone.utc).isoformat()}",
    ).on_conflict_do_nothing(index_elements=["sample_key"]))
