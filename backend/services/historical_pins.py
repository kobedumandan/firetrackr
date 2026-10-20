"""Reproducible representative pins for address-only historical incident records."""
from sqlalchemy import text


def specify_pin(conn, metadata, brgy_id):
    lat, lng = float(metadata['latitude']), float(metadata['longitude'])
    boundary = conn.execute(text('''SELECT brgy_name,
        ST_Y(ST_PointOnSurface(brgy_polygon)) AS lat,
        ST_X(ST_PointOnSurface(brgy_polygon)) AS lng,
        ST_Covers(brgy_polygon,ST_SetSRID(ST_MakePoint(:lng,:lat),4326)) AS inside
        FROM barangay_boundaries WHERE brgy_id=:id'''), {'id':brgy_id,'lat':lat,'lng':lng}).first() if brgy_id else None
    if boundary and boundary.inside and metadata.get('geocode_precision') in ('exact_or_building','street_or_area'):
        basis = 'address_estimate'
        label = 'Estimated address / purok pin'
        specification = 'Existing geocoded address candidate inside the named barangay. The source contains no measured fire-site coordinates.'
    elif boundary:
        lat, lng = boundary.lat, boundary.lng
        basis = 'barangay_representative'
        label = 'Barangay representative pin'
        specification = 'A reproducible point inside the named barangay polygon; the purok or exact property could not be located reliably.'
    else:
        city = conn.execute(text('''SELECT ST_Covers(ST_Union(brgy_polygon),ST_SetSRID(ST_MakePoint(:lng,:lat),4326)) AS inside,
            ST_Y(ST_PointOnSurface(ST_Union(brgy_polygon))) AS lat,
            ST_X(ST_PointOnSurface(ST_Union(brgy_polygon))) AS lng FROM barangay_boundaries'''), {'lat':lat,'lng':lng}).one()
        if not city.inside:
            lat, lng = city.lat, city.lng
        basis = 'city_reference'
        label = 'City reference pin · barangay unresolved'
        specification = 'Approximate Panabo reference point. The source says Brgy Lemonsito, which is not matched to the boundary dataset; this pin does not establish the barangay.'
    return {'basis':basis,'label':label,'specification':specification,
            'latitude':lat,'longitude':lng,'verified':False,
            'source_address':metadata.get('raw_location',''),
            'heatmap_note':'Representative pins can concentrate incidents at an area reference point; this is not an exact fire-site hotspot.'}
