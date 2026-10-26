// Split a [lat, lon] route into the traveled and remaining paths. An off-route
// truck leaves the full path visible until it rejoins or receives a new route.
export function splitRouteAtPoint(line, pt) {
  if (!line || line.length < 2 || !pt) {
    return { traveled: [], remaining: line || [] };
  }
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
      best = { i, point, d };
    }
  }

  if (best.d > 60) return { traveled: [], remaining: line };
  return {
    traveled: [...line.slice(0, best.i + 1), best.point],
    remaining: [best.point, ...line.slice(best.i + 1)],
  };
}

export function truckProgressPoint(dispatchId, liveLocations) {
  const drivers = liveLocations.filter(person => person.dispatch_id === dispatchId
    && person.manned_truck?.truck_id != null && !person.is_stale
    && Number.isFinite(person.latitude) && Number.isFinite(person.longitude));
  // Manning metadata is authoritative. Other personnel must never move the
  // truck's progress, including when there is no confirmed driver location.
  if (drivers.length !== 1) return null;
  return [drivers[0].latitude, drivers[0].longitude];
}
