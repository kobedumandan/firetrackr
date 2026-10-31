const ROUTE_SNAP_METERS = 60;
const validPoint = point => Array.isArray(point) && point.length >= 2
  && Number.isFinite(point[0]) && Number.isFinite(point[1]);

function projectRoutePoint(line, pt) {
  if (!line || line.length < 2 || !validPoint(pt)) return null;
  const D2R = Math.PI / 180;
  const lat0 = pt[0] * D2R;
  const mx = (lon) => lon * D2R * Math.cos(lat0) * 6371000;
  const my = (lat) => lat * D2R * 6371000;
  const px = mx(pt[1]);
  const py = my(pt[0]);

  let best = { i: 0, point: line[0], d: Infinity };
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const ax = mx(a[1]);
    const ay = my(a[0]);
    const dx = mx(b[1]) - ax;
    const dy = my(b[0]) - ay;
    const L2 = dx * dx + dy * dy;
    let t = L2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    const ex = px - (ax + dx * t);
    const ey = py - (ay + dy * t);
    const d = Math.sqrt(ex * ex + ey * ey);
    if (d < best.d) {
      const point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      best = { i, point, d, progress: i + t };
    }
  }

  return best.d <= ROUTE_SNAP_METERS ? best : null;
}

// Split a [lat, lon] route at an accepted fix. An off-route truck leaves the
// full path visible until it rejoins or receives a new route.
export function splitRouteAtPoint(line, pt) {
  const best = projectRoutePoint(line, pt);
  if (!best) return { traveled: [], remaining: line || [] };
  return {
    traveled: [...line.slice(0, best.i + 1), best.point],
    remaining: [best.point, ...line.slice(best.i + 1)],
  };
}

// Keep truck progress independent, and expose the part behind it that another
// responder still needs. This is an active approach, not a historical trail.
export function dispatchRouteProgress(line, dispatchId, liveLocations = [], includePersonnel = true) {
  const truckPoint = truckProgressPoint(dispatchId, liveLocations);
  const truck = projectRoutePoint(line, truckPoint);
  const remaining = truck ? [truck.point, ...line.slice(truck.i + 1)] : line || [];
  const result = { remaining, personnelRemaining: [], personnel: [] };
  if (!truck || !includePersonnel) return result;

  let earliest = truck;
  for (const person of liveLocations) {
    if (person.dispatch_id !== dispatchId || person.manned_truck?.truck_id != null
      || person.is_stale || person.personnel_arrived_at
      || !Number.isFinite(person.latitude) || !Number.isFinite(person.longitude)
      || ['on_scene', 'onscene'].includes(person.personnel_status)
      || ['off', 'standby', 'on_scene'].includes(person.tracking?.mode)) continue;

    const connector = person.connector_geojson;
    const point = person.is_deviated
      ? connector?.merges === true && validPoint(connector.merge_point)
        ? [connector.merge_point[1], connector.merge_point[0]] : null
      : [person.latitude, person.longitude];
    const projection = projectRoutePoint(line, point);
    if (!projection || projection.progress >= truck.progress - 1e-9) continue;

    result.personnel.push(person);
    if (projection.progress < earliest.progress) earliest = projection;
  }
  if (earliest !== truck) {
    result.personnelRemaining = [earliest.point, ...line.slice(earliest.i + 1, truck.i + 1), truck.point];
  }
  return result;
}

export function truckProgressPoint(dispatchId, liveLocations = []) {
  const drivers = liveLocations.filter(person => person.dispatch_id === dispatchId
    && person.manned_truck?.truck_id != null && !person.is_stale
    && Number.isFinite(person.latitude) && Number.isFinite(person.longitude));
  // Manning metadata is authoritative. Other personnel must never move the
  // truck's progress, including when there is no confirmed driver location.
  if (drivers.length !== 1) return null;
  return [drivers[0].latitude, drivers[0].longitude];
}
