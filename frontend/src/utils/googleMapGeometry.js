// Google renamed these properties across SDK releases. Assign after creation
// so an older SDK can't silently discard geometry in its options dictionary.
export function setGoogleLinePath(element, path) {
  if ('path' in element || !('coordinates' in element)) element.path = path
  else element.coordinates = path
}

export function setGooglePolygonPaths(element, { path, innerPaths = [] }) {
  if ('path' in element || !('outerCoordinates' in element)) {
    element.path = path
    // The weekly SDK rejects an empty iterable. Leave fresh polygons without
    // holes unset; undefined clears holes when updating an existing polygon.
    if (innerPaths.length || element.innerPaths?.length) element.innerPaths = innerPaths.length ? innerPaths : undefined
  } else {
    element.outerCoordinates = path
    if (innerPaths.length || element.innerCoordinates?.length) element.innerCoordinates = innerPaths.length ? innerPaths : undefined
  }
}
