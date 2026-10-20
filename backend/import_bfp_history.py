"""Review-first BFP historical import; no schema changes or fabricated crew assignments.

prepare() validates the original XLSX against the cleaned review and exports a CSV.
replace_incidents() must be called in a transaction with an explicitly reviewed ID
list. The caller must back up the database first. Resource tables are never written.
"""
import csv
import hashlib
import json
import random
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import text
from services.historical_pins import specify_pin

PHT = timezone(timedelta(hours=8))
TIMELINE_FIELDS = ("report_received_at", "dispatch_at", "departed_at", "arrived_at",
                   "suppression_started_at", "fire_out_at")


def prepare(excel, review_csv, output_csv):
    import openpyxl  # Import-only dependency, not needed by the running API.
    workbook = openpyxl.load_workbook(excel, read_only=True, data_only=True)
    sheet = workbook.active
    source = {}
    for index, row in enumerate(sheet.values, 1):
        if not row[0] or not row[1] or row[0] == "Exact Location":
            continue
        date = row[1] if isinstance(row[1], datetime) else datetime.strptime(str(row[1]), "%d-%b-%y")
        source[index] = (str(row[0]).strip(), date.date().isoformat(), *(str(v).strip() if v else "Not recorded" for v in row[2:5]))
    workbook.close()
    with open(review_csv, encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    assert len(rows) == len(source), "Source/review row counts differ."
    seen = set()
    for row in rows:
        raw = source[int(row["source_excel_row"])]
        normalize = lambda value: " ".join(value.split())
        reviewed = (row["raw_location"], row["incident_date"], row["general_category_raw"], row["sub_category_raw"], row["cause_raw"])
        assert tuple(map(normalize, raw)) == tuple(map(normalize, reviewed)), f"Source mismatch: {row['record_id']}"
        row["raw_location"] = raw[0]
        fingerprint = hashlib.sha256(json.dumps(raw, ensure_ascii=False).encode()).hexdigest()
        assert fingerprint not in seen, "Exact duplicate source incident requires review."
        seen.add(fingerprint)
        row["import_key"] = "bfp-panabo-2023-2024:" + fingerprint
        rng = random.Random(fingerprint)
        receipt = datetime.fromisoformat(row["incident_date"]).replace(tzinfo=PHT) + timedelta(minutes=rng.randint(480, 1080))
        # Explicit showcase assumptions; neither BFP standards nor measured response.
        process, prep, travel = rng.randint(60,240), rng.randint(120,360), rng.randint(300,840)
        suppress = rng.randint(1200,3000) if row["occupancy_class_clean"] == "STRUCTURAL" else rng.randint(600,1800)
        dispatch = receipt + timedelta(seconds=process)
        departure = dispatch + timedelta(seconds=prep)
        arrival = departure + timedelta(seconds=travel)
        start = arrival + timedelta(seconds=rng.randint(30,120))
        end = start + timedelta(seconds=suppress)
        row.update(dict(zip(TIMELINE_FIELDS, (t.isoformat() for t in (receipt,dispatch,departure,arrival,start,end)))))
        row.update(timing_basis="synthetic_demo", timing_verified="No", occurrence_precision="date_only",
                   timing_assumptions="Receipt 08:00-18:00 PHT; processing 1-4 min; preparation 2-6 min; travel 5-14 min; arrival-to-suppression 0.5-2 min; suppression structural 20-50 min, other 10-30 min. Deterministic demonstration only.")
        row["point_heatmap_eligible"] = "Yes" if row["geocode_review_required"] == "No" and row["inside_expected_barangay"] == "Yes" else "No"
    Path(output_csv).parent.mkdir(parents=True,exist_ok=True)
    with open(output_csv,"w",encoding="utf-8-sig",newline="") as handle:
        writer=csv.DictWriter(handle,fieldnames=list(rows[0])); writer.writeheader(); writer.writerows(rows)
    return rows


def normalized_name(name):
    name = name.casefold().replace("ñ","n").replace("�","n")
    return re.sub(r"[^a-z0-9]", "", name)


def replace_incidents(conn, rows, replace_ids):
    """Atomic FK-aware replacement of reviewed IDs only; keep unrelated data intact."""
    ids = list(replace_ids)
    protected = ("users", "admin", "personnel", "stations", "response_teams", "response_team_members", "truck", "shifts", "barangay_boundaries")
    def digest(table):
        return conn.execute(text(f"SELECT md5(COALESCE(string_agg(row_to_json(t)::text, '' ORDER BY row_to_json(t)::text), '')) FROM {table} t")).scalar_one()
    before = {t:digest(t) for t in protected}
    # Block concurrent incident changes for the short replacement transaction.
    conn.execute(text("LOCK TABLE fire_incidents, dispatch_records, dispatch_trucks, routes, incident_reports, incident_events, heatmap_data IN SHARE ROW EXCLUSIVE MODE"))
    if ids:
        params = {"ids": ids}
        conn.execute(text("DELETE FROM truck_logs WHERE dispatch_truck_id IN (SELECT dt.dispatch_truck_id FROM dispatch_trucks dt JOIN dispatch_records d USING(dispatch_id) WHERE d.fire_id = ANY(:ids))"),params)
        conn.execute(text("DELETE FROM incident_events WHERE fire_id = ANY(:ids)"),params)
        conn.execute(text("DELETE FROM report_photos WHERE report_id IN (SELECT report_id FROM incident_reports WHERE fire_id = ANY(:ids))"),params)
        conn.execute(text("DELETE FROM incident_reports WHERE fire_id = ANY(:ids)"),params)
        conn.execute(text("UPDATE dispatch_records SET route_id=NULL WHERE fire_id = ANY(:ids)"),params)
        conn.execute(text("DELETE FROM dispatch_trucks WHERE dispatch_id IN (SELECT dispatch_id FROM dispatch_records WHERE fire_id = ANY(:ids))"),params)
        conn.execute(text("DELETE FROM routes WHERE fire_id = ANY(:ids)"),params)
        conn.execute(text("DELETE FROM dispatch_records WHERE fire_id = ANY(:ids)"),params)
        conn.execute(text("DELETE FROM heatmap_data WHERE fire_id = ANY(:ids)"),params)
        conn.execute(text("DELETE FROM fire_incidents WHERE fire_id = ANY(:ids)"),params)
    boundaries = {normalized_name(r.brgy_name):r for r in conn.execute(text("SELECT brgy_id,brgy_name FROM barangay_boundaries"))}
    imported = skipped = mapped = 0
    for row in rows:
        if conn.execute(text("SELECT 1 FROM incident_events WHERE idempotency_key=:key"),{"key":row["import_key"]}).first():
            skipped += 1; continue
        boundary = boundaries.get(normalized_name(row["barangay_clean"]))
        if not boundary and row["barangay_clean"] != "Not identified":
            raise ValueError(f"Unknown barangay: {row['barangay_clean']}")
        pin = specify_pin(conn, row, boundary.brgy_id if boundary else None)
        lat, lng = pin['latitude'], pin['longitude']
        row['point_heatmap_eligible'] = 'Yes'
        row['import_coordinate_note'] = pin['specification']
        row["import_latitude"], row["import_longitude"] = lat, lng
        meta = dict(row)
        meta['pin_specification'] = pin
        meta["synthetic_timeline"] = {key:row[key] for key in TIMELINE_FIELDS}
        meta["timing_basis"]="synthetic_demo"
        meta["alarm_basis"]="synthetic_demo"
        meta["source_file"]= "Fire-incident-2023-2024.xlsx"
        meta["import_latitude"],meta["import_longitude"] = lat,lng
        remarks = f"BFP historical record {row['record_id']}. Dates, property categories and cause from source workbook. Alarm and operational times are synthetic showcase assumptions; actual times unknown. Location: {row['import_coordinate_note']} Cause: {row['cause_clean']}."
        fire_id = conn.execute(text("""INSERT INTO fire_incidents
            (fire_location_source,fire_location_name,fire_address,fire_latitude,fire_longitude,
             fire_severity,fire_status,fire_alarm_level,fire_dispatch_type,fire_structure_type,
             fire_casualties,fire_units_assigned,fire_remarks,fire_incident_datetime,
             response_kind,brgy_id)
            VALUES ('bfp_historical_import',:barangay,:address,:lat,:lng,NULL,'closed',:alarm,
                    'Firefighting Operations',:property,'Not recorded',0,:remarks,:occurred,'fire',:brgy_id)
            RETURNING fire_id"""),{"barangay":boundary.brgy_name if boundary else "Barangay unresolved", "address":row["raw_location"][:255],"lat":lat,"lng":lng,
                "alarm":row["synthetic_alarm_level"],"property":row["general_category_clean"],"remarks":remarks,
                "occurred":datetime.fromisoformat(row["incident_date"]).replace(tzinfo=PHT),"brgy_id":boundary.brgy_id if boundary else None}).scalar_one()
        # Synthetic milestones live in metadata, so normal recorded-time queries stay honest.
        conn.execute(text("""INSERT INTO incident_events
            (fire_id,event_type,event_actor,created_at,occurred_at,source,verified,idempotency_key,event_metadata)
            VALUES (:id,'bfp_import','BFP workbook import',now(),:occurred,'bfp_excel_demo',false,:key,CAST(:metadata AS jsonb))"""),
            {"id":fire_id,"occurred":datetime.fromisoformat(row["incident_date"]).replace(tzinfo=PHT),"key":row["import_key"],"metadata":json.dumps(meta)})
        if row["point_heatmap_eligible"] == "Yes":
            conn.execute(text("""INSERT INTO heatmap_data (fire_id,heatmap_latitude,heatmap_longitude,heatmap_severity_weight,heatmap_density_value,heatmap_generated_at)
                VALUES (:id,:lat,:lng,0.5,1,now())"""),{"id":fire_id,"lat":lat,"lng":lng})
            mapped+=1
        imported+=1
    if before != {t:digest(t) for t in protected}:
        raise RuntimeError("Protected resource data changed; rollback required.")
    return {"deleted_incidents":len(ids),"imported_incidents":imported,"already_imported":skipped,"candidate_heatmap_points":mapped,"protected_tables_unchanged":list(protected)}
