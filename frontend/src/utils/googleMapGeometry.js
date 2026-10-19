// Google renamed these properties across SDK releases. Assign after creation
// so an older SDK can't silently discard geometry in its options dictionary.
export function setGoogleLinePath(element, path) {
  if ('path' in element || !('coordinates' in element)) element.path = path
  else element.coordinates = path
}

export function setGooglePolygonPaths(element, { path, innerPaths = [] }) {
  if ('path' in element || !('outerCoordinates' in element)) {
    element.path = path
    element.innerPaths = innerPaths
  } else {
    element.outerCoordinates = path
    element.innerCoordinates = innerPaths
  }
}
