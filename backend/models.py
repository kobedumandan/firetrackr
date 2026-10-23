from sqlalchemy import (
    Column, Integer, String, Float, Text, DateTime,
    Boolean, ForeignKey, Numeric, JSON, CheckConstraint, Index, text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from geoalchemy2 import Geometry
from datetime import datetime, timezone

from database import Base


def _now():
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Users & roles
# ---------------------------------------------------------------------------

class Users(Base):
    __tablename__ = "users"

    user_id      = Column(Integer, primary_key=True, autoincrement=True)
    user_email   = Column(String(255), unique=True, nullable=False)
    user_password = Column(String(255), nullable=False)
    user_role    = Column(String(50))          # "admin" | "personnel" | ...
    created_at   = Column(DateTime(timezone=True), default=_now)
    updated_at   = Column(DateTime(timezone=True), default=_now, onupdate=_now)
    # Null for accounts still on their seeded password; the Security tab falls
    # back to created_at so the row never reads "never changed" misleadingly.
    password_changed_at = Column(DateTime(timezone=True))

    admin                = relationship("Admin",        back_populates="user", uselist=False)
    personnel            = relationship("Personnel",    back_populates="user", uselist=False)
    confirmed_incidents  = relationship("FireIncident", back_populates="confirmed_by")
    login_history        = relationship(
        "LoginHistory", back_populates="user",
        cascade="all, delete-orphan", passive_deletes=True,
    )


class Admin(Base):
    __tablename__ = "admin"

    admin_id        = Column(Integer, primary_key=True, autoincrement=True)
    admin_firstname = Column(String(100))
    admin_lastname  = Column(String(100))
    admin_contact   = Column(String(50))
    user_id         = Column(Integer, ForeignKey("users.user_id"), nullable=False)

    user = relationship("Users", back_populates="admin")


# ---------------------------------------------------------------------------
# Shifts (fixed lookup — Shift A / Shift B)
# ---------------------------------------------------------------------------

class Shift(Base):
    __tablename__ = "shifts"

    shift_id   = Column(Integer, primary_key=True, autoincrement=True)
    shift_name = Column(String(50), unique=True, nullable=False)

    personnel = relationship("Personnel", back_populates="shift")


# ---------------------------------------------------------------------------
# Personnel & devices
# ---------------------------------------------------------------------------

class Personnel(Base):
    __tablename__ = "personnel"

    per_id          = Column(Integer, primary_key=True, autoincrement=True)
    per_firstname   = Column(String(100))
    per_lastname    = Column(String(100))
    per_contact     = Column(String(50))
    per_rank        = Column(String(100))
    per_designation = Column(String(100))
    user_id         = Column(Integer, ForeignKey("users.user_id"),        nullable=False)
    station_id      = Column(Integer, ForeignKey("stations.station_id"),  nullable=True)
    shift_id        = Column(Integer, ForeignKey("shifts.shift_id"),      nullable=True)

    user             = relationship("Users",              back_populates="personnel")
    station          = relationship("Station",            back_populates="personnel", foreign_keys="Personnel.station_id")
    devices          = relationship("Device",             back_populates="personnel")
    team_memberships = relationship("ResponseTeamMember", back_populates="personnel")
    shift            = relationship("Shift",              back_populates="personnel")
    push_tokens      = relationship(
        "PushToken", back_populates="personnel", cascade="all, delete-orphan",
    )


class PushToken(Base):
    """An Expo push token for one of a responder's phones.

    Keyed by the token itself: a phone has exactly one, and if a different
    account signs in on the same phone the row is reassigned rather than
    duplicated, so the previous user stops receiving that phone's alerts.
    """
    __tablename__ = "push_tokens"

    token         = Column(String(255), primary_key=True)
    per_id        = Column(Integer, ForeignKey("personnel.per_id", ondelete="CASCADE"),
                           nullable=False, index=True)
    platform      = Column(String(20))
    # Picks the Android channel: "dispatch" (siren-style) or "dispatch-silent".
    sound_enabled = Column(Boolean, nullable=False, default=True)
    created_at    = Column(DateTime(timezone=True), default=_now)
    last_seen_at  = Column(DateTime(timezone=True), default=_now, onupdate=_now)

    personnel = relationship("Personnel", back_populates="push_tokens")


class Device(Base):
    __tablename__ = "devices"

    device_id       = Column(Integer, primary_key=True, autoincrement=True)
    device_imei     = Column(String(20), unique=True)
    device_sim      = Column(String(20))
    device_status   = Column(String(50))
    device_lastseen = Column(DateTime(timezone=True))
    per_id          = Column(Integer, ForeignKey("personnel.per_id"), nullable=False)

    personnel     = relationship("Personnel",   back_populates="devices")
    location_logs = relationship("LocationLog", back_populates="device")


class LocationLog(Base):
    __tablename__ = "location_logs"

    log_id         = Column(Integer, primary_key=True, autoincrement=True)
    device_id      = Column(Integer, ForeignKey("devices.device_id"), nullable=True)
    log_latitude   = Column(Float, nullable=False)
    log_longitude  = Column(Float, nullable=False)
    log_receive_at = Column(DateTime(timezone=True), default=_now)

    device = relationship("Device", back_populates="location_logs")


class CurrentLocation(Base):
    """Live position per personnel — one row per person, upserted on each update."""
    __tablename__ = "current_locations"

    per_id      = Column(Integer, ForeignKey("personnel.per_id", ondelete="CASCADE"), primary_key=True)
    latitude    = Column(Numeric(10, 8), nullable=False)
    longitude   = Column(Numeric(11, 8), nullable=False)
    source      = Column(String(20), nullable=False)   # "mobile_app" | "iot_sms"
    recorded_at = Column(DateTime(timezone=True), nullable=False)
    received_at = Column(DateTime(timezone=True), nullable=False)
    battery     = Column(Integer, nullable=True)

    personnel = relationship("Personnel", backref="current_location", uselist=False)


# ---------------------------------------------------------------------------
# Response teams
# ---------------------------------------------------------------------------

class ResponseTeam(Base):
    __tablename__ = "response_teams"

    team_id         = Column(Integer, primary_key=True, autoincrement=True)
    team_name       = Column(String(150))
    team_code       = Column(String(50))
    team_status     = Column(String(50))
    station_id      = Column(Integer, ForeignKey("stations.station_id"), nullable=True)
    shift_id        = Column(Integer, ForeignKey("shifts.shift_id"),     nullable=True)
    # A team is assigned one truck. A truck may be shared by teams on different
    # shifts, so this is a many-teams -> one-truck relationship.
    truck_id        = Column(Integer, ForeignKey("truck.truck_id"),      nullable=True)
    team_created_at = Column(DateTime(timezone=True), default=_now)
    team_updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now)

    station    = relationship("Station",            back_populates="response_teams")
    shift      = relationship("Shift")
    truck      = relationship("Truck",              back_populates="teams")
    members    = relationship("ResponseTeamMember", back_populates="team")
    dispatches = relationship("DispatchRecord",     back_populates="team")


class ResponseTeamMember(Base):
    __tablename__ = "response_team_members"

    members_id    = Column(Integer, primary_key=True, autoincrement=True)
    team_id       = Column(Integer, ForeignKey("response_teams.team_id"), nullable=False)
    per_id        = Column(Integer, ForeignKey("personnel.per_id"),       nullable=False)
    member_role   = Column(String(100))
    member_status = Column(String(50))

    team      = relationship("ResponseTeam", back_populates="members")
    personnel = relationship("Personnel",    back_populates="team_memberships")


# ---------------------------------------------------------------------------
# Trucks
# ---------------------------------------------------------------------------

class Truck(Base):
    __tablename__ = "truck"

    truck_id           = Column(Integer, primary_key=True, autoincrement=True)
    truck_platenum     = Column(String(20), unique=True)
    truck_status       = Column(String(50))
    truck_latitude     = Column(Float)
    truck_longitude    = Column(Float)
    truck_last_updated = Column(DateTime(timezone=True))
    station_id         = Column(Integer, ForeignKey("stations.station_id"), nullable=True)

    station         = relationship("Station",      back_populates="trucks")
    truck_logs      = relationship("TruckLog",     back_populates="truck")
    dispatch_trucks = relationship("DispatchTruck", back_populates="truck")
    teams           = relationship("ResponseTeam",  back_populates="truck")


class TruckLog(Base):
    __tablename__ = "truck_logs"

    truck_log_id       = Column(Integer, primary_key=True, autoincrement=True)
    truck_id           = Column(Integer, ForeignKey("truck.truck_id"), nullable=False)
    truck_log_lat      = Column(Float, nullable=False)
    truck_log_long     = Column(Float, nullable=False)
    truck_log_recorded = Column(DateTime(timezone=True), default=_now)
    dispatch_truck_id  = Column(Integer, ForeignKey("dispatch_trucks.dispatch_truck_id", ondelete="SET NULL"), index=True)
    accuracy_m        = Column(Float)
    received_at       = Column(DateTime(timezone=True))
    source            = Column(String(30))
    sample_key        = Column(String(160), unique=True)
    per_id            = Column(Integer, ForeignKey("personnel.per_id", ondelete="SET NULL"))

    truck = relationship("Truck", back_populates="truck_logs")


# ---------------------------------------------------------------------------
# Stations
# ---------------------------------------------------------------------------

class Station(Base):
    __tablename__ = "stations"

    station_id         = Column(Integer, primary_key=True, autoincrement=True)
    station_name       = Column(String(150), unique=True, nullable=False)
    station_type       = Column(String(10), nullable=False, default="main")  # "main" | "sub"
    parent_station_id  = Column(Integer, ForeignKey("stations.station_id"), nullable=True)
    station_address    = Column(String(255))
    station_barangay   = Column(String(150))
    station_latitude   = Column(Float)
    station_longitude  = Column(Float)
    station_contact      = Column(String(50))
    station_status       = Column(String(50))   # "operational" | "inactive"
    station_commander_id = Column(Integer, ForeignKey("personnel.per_id"), nullable=True)
    created_at           = Column(DateTime(timezone=True), default=_now)
    updated_at           = Column(DateTime(timezone=True), default=_now, onupdate=_now)

    parent         = relationship("Station", remote_side="Station.station_id", foreign_keys=[parent_station_id])
    personnel      = relationship("Personnel",    back_populates="station", foreign_keys="Personnel.station_id")
    commander      = relationship("Personnel",    foreign_keys=[station_commander_id])
    trucks         = relationship("Truck",        back_populates="station")
    response_teams = relationship("ResponseTeam", back_populates="station")


# ---------------------------------------------------------------------------
# Fire incidents
# ---------------------------------------------------------------------------

class FireIncident(Base):
    __tablename__ = "fire_incidents"

    fire_id                = Column(Integer, primary_key=True, autoincrement=True)
    confirmed_user_id      = Column(Integer, ForeignKey("users.user_id"), nullable=True)
    fire_reporter_contact  = Column(String(50))
    fire_reporter_name     = Column(String(150))
    fire_location_source   = Column(String(100))   # "gps" | "manual" | "report"
    fire_location_name     = Column(String(255))   # barangay / area label
    fire_address           = Column(String(255))   # street address
    fire_latitude          = Column(Float, nullable=False)
    fire_longitude         = Column(Float, nullable=False)
    fire_severity          = Column(String(50))    # "Minor" | "Moderate" | "Critical"
    fire_status            = Column(String(50))    # "pending" | "active" | "dispatched" | "contained" | "closed"
    fire_alarm_level       = Column(String(50))    # "1st Alarm" | "2nd Alarm" | "3rd Alarm"
    fire_dispatch_type     = Column(String(100), nullable=True)
    fire_structure_type    = Column(String(100))   # "Residential" | "Commercial" | ...
    fire_casualties        = Column(String(100))   # "None" | "Unconfirmed" | ...
    fire_units_assigned    = Column(Integer, default=0)
    fire_remarks           = Column(Text, nullable=True)
    fire_incident_datetime = Column(DateTime(timezone=True), default=_now)
    report_received_at     = Column(DateTime(timezone=True), index=True)
    created_at             = Column(DateTime(timezone=True), default=_now)
    record_kind            = Column(String(20))  # operational | drill | test | unknown
    suppression_started_at = Column(DateTime(timezone=True))
    fire_out_at            = Column(DateTime(timezone=True))
    response_kind          = Column(String(20))  # fire | medical | rescue | other; NULL = unknown
    brgy_id                = Column(Integer, ForeignKey("barangay_boundaries.brgy_id"), nullable=True)

    confirmed_by  = relationship("Users",              back_populates="confirmed_incidents")
    routes        = relationship("Route",              back_populates="fire_incident")
    heatmap_data  = relationship("HeatmapData",        back_populates="fire_incident")
    dispatches    = relationship("DispatchRecord",     back_populates="fire_incident")
    barangay      = relationship("BarangayBoundary",   back_populates="fire_incidents")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

class Route(Base):
    __tablename__ = "routes"

    route_id              = Column(Integer, primary_key=True, autoincrement=True)
    fire_id               = Column(Integer, ForeignKey("fire_incidents.fire_id"), nullable=False)
    dispatch_id           = Column(Integer, ForeignKey("dispatch_records.dispatch_id", ondelete="CASCADE"), nullable=True, index=True)
    route_rank            = Column(Integer)          # 1 = best, 2 = alternate, …
    route_type            = Column(String(50))       # "fastest" | "shortest" | "ai_optimized"
    route_path_geojson    = Column(Text)             # GeoJSON LineString
    route_distance_meters = Column(Float)
    route_est_minutes     = Column(Float)
    route_is_selected     = Column(Boolean, default=False)
    route_created_at      = Column(DateTime(timezone=True), default=_now)
    route_origin_source   = Column(String(20), default="station")   # "station" | "driver_location"
    route_origin_lat      = Column(Numeric(10, 8), nullable=True)
    route_origin_lng      = Column(Numeric(11, 8), nullable=True)

    fire_incident    = relationship("FireIncident",  back_populates="routes")
    # Two FK paths exist between routes and dispatch_records:
    #   1. dispatch_records.route_id -> routes.route_id  (which route a dispatch is using)
    #   2. routes.dispatch_id        -> dispatch_records.dispatch_id  (which dispatch owns this route)
    # Disambiguate each relationship with foreign_keys.
    dispatch_records = relationship(
        "DispatchRecord",
        back_populates="route",
        foreign_keys="DispatchRecord.route_id",
    )
    owning_dispatch = relationship(
        "DispatchRecord",
        back_populates="routes",
        foreign_keys="Route.dispatch_id",
    )


# ---------------------------------------------------------------------------
# Heatmap
# ---------------------------------------------------------------------------

class HeatmapData(Base):
    __tablename__ = "heatmap_data"

    heatmap_id              = Column(Integer, primary_key=True, autoincrement=True)
    fire_id                 = Column(Integer, ForeignKey("fire_incidents.fire_id"), nullable=False)
    heatmap_latitude        = Column(Float, nullable=False)
    heatmap_longitude       = Column(Float, nullable=False)
    heatmap_severity_weight = Column(Float)
    heatmap_density_value   = Column(Float)
    heatmap_generated_at    = Column(DateTime(timezone=True), default=_now)

    fire_incident = relationship("FireIncident", back_populates="heatmap_data")


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

class DispatchRecord(Base):
    __tablename__ = "dispatch_records"

    dispatch_id           = Column(Integer, primary_key=True, autoincrement=True)
    fire_id               = Column(Integer, ForeignKey("fire_incidents.fire_id"),   nullable=False)
    team_id               = Column(Integer, ForeignKey("response_teams.team_id"),   nullable=False)
    route_id              = Column(Integer, ForeignKey("routes.route_id"),          nullable=True)
    dispatch_status       = Column(String(50))   # "dispatched" | "en_route" | "on_scene" | "completed"
    dispatch_at           = Column(DateTime(timezone=True), default=_now)
    dispatch_arrived_at   = Column(DateTime(timezone=True), nullable=True)
    dispatch_completed_at = Column(DateTime(timezone=True), nullable=True)
    dispatch_truck_count  = Column(Integer, default=0)
    acknowledged_at       = Column(DateTime(timezone=True))
    acknowledged_by       = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"))
    departed_at           = Column(DateTime(timezone=True))
    departed_by           = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"))
    context_snapshot      = Column(JSONB)
    is_deviated                 = Column(Boolean, nullable=False, default=False)
    deviation_connector_geojson = Column(JSONB, nullable=True)
    deviation_detected_at       = Column(DateTime(timezone=True), nullable=True)

    fire_incident   = relationship("FireIncident", back_populates="dispatches")
    team            = relationship("ResponseTeam", back_populates="dispatches")
    route           = relationship(
        "Route",
        back_populates="dispatch_records",
        foreign_keys=[route_id],
    )
    routes          = relationship(
        "Route",
        back_populates="owning_dispatch",
        foreign_keys="Route.dispatch_id",
        cascade="all, delete-orphan",
    )
    dispatch_trucks = relationship("DispatchTruck", back_populates="dispatch_record")


class DispatchTruck(Base):
    __tablename__ = "dispatch_trucks"

    dispatch_truck_id = Column(Integer, primary_key=True, autoincrement=True)
    dispatch_id       = Column(Integer, ForeignKey("dispatch_records.dispatch_id"), nullable=False)
    truck_id          = Column(Integer, ForeignKey("truck.truck_id"),               nullable=False)
    truck_assigned_at = Column(DateTime(timezone=True), default=_now)
    # Personnel who has explicitly claimed they are manning/driving this truck.
    # When NULL, no one's GPS drives the truck position — we never infer occupancy.
    manned_by_per_id  = Column(Integer, ForeignKey("personnel.per_id"), nullable=True)
    manned_since      = Column(DateTime(timezone=True), nullable=True)
    departed_at       = Column(DateTime(timezone=True))
    arrived_at        = Column(DateTime(timezone=True))

    dispatch_record = relationship("DispatchRecord", back_populates="dispatch_trucks")
    truck           = relationship("Truck",          back_populates="dispatch_trucks")
    manned_by       = relationship("Personnel",      foreign_keys=[manned_by_per_id])


class DispatchLocation(Base):
    """JWT-attributed samples; retention follows explicit dispatch deletion."""
    __tablename__ = "dispatch_locations"
    sample_id = Column(Integer, primary_key=True, autoincrement=True)
    dispatch_id = Column(Integer, ForeignKey("dispatch_records.dispatch_id", ondelete="CASCADE"), nullable=False)
    per_id = Column(Integer, ForeignKey("personnel.per_id", ondelete="SET NULL"))
    truck_id = Column(Integer, ForeignKey("truck.truck_id", ondelete="SET NULL"))
    recorded_at = Column(DateTime(timezone=True), nullable=False)
    received_at = Column(DateTime(timezone=True), nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    accuracy_m = Column(Float)
    source = Column(String(30), nullable=False)
    sample_key = Column(String(160), unique=True, nullable=False)


# ---------------------------------------------------------------------------
# Incident reports (after-action report written by personnel on scene)
# ---------------------------------------------------------------------------

class IncidentReport(Base):
    """An after-action report authored by responding personnel once a fire is
    contained. Submitting the report closes the incident (fire_status='closed')."""
    __tablename__ = "incident_reports"

    report_id              = Column(Integer, primary_key=True, autoincrement=True)
    fire_id                = Column(Integer, ForeignKey("fire_incidents.fire_id"),     nullable=False, index=True)
    dispatch_id            = Column(Integer, ForeignKey("dispatch_records.dispatch_id"), nullable=True)
    per_id                 = Column(Integer, ForeignKey("personnel.per_id"),           nullable=False)
    report_cause           = Column(String(255), nullable=True)   # probable cause of fire
    report_casualties      = Column(String(255), nullable=True)   # casualties / injuries summary
    report_damage_estimate = Column(String(100), nullable=True)   # estimated damage (e.g. peso value)
    report_narrative       = Column(Text, nullable=False)         # main account of the response
    report_recommendations = Column(Text, nullable=True)          # optional recommendations / remarks
    report_submitted_at    = Column(DateTime(timezone=True), default=_now)
    created_at             = Column(DateTime(timezone=True), default=_now)

    fire_incident = relationship("FireIncident")
    dispatch      = relationship("DispatchRecord")
    author        = relationship("Personnel")
    photos        = relationship(
        "ReportPhoto", back_populates="report",
        cascade="all, delete-orphan", order_by="ReportPhoto.photo_id",
    )


# ---------------------------------------------------------------------------
# Incident events (status / alarm / severity history for the timeline)
# ---------------------------------------------------------------------------

class IncidentEvent(Base):
    """One change to an incident's status, alarm level or severity. Only the
    current values live on fire_incidents; this records when each changed and
    who changed it. Dispatch/arrival times stay on dispatch_records."""
    __tablename__ = "incident_events"

    event_id    = Column(Integer, primary_key=True, autoincrement=True)
    fire_id     = Column(Integer, ForeignKey("fire_incidents.fire_id", ondelete="CASCADE"), nullable=False, index=True)
    event_type  = Column(String(30), nullable=False)   # "status" | "alarm" | "severity"
    event_from  = Column(String(50), nullable=True)
    event_to    = Column(String(50), nullable=True)
    user_id     = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    event_actor = Column(String(150), nullable=True)   # display name, kept if the account goes
    created_at  = Column(DateTime(timezone=True), default=_now, nullable=False)

    # Operational audit: created_at remains server receipt, occurred_at is event time.
    occurred_at = Column(DateTime(timezone=True))
    source = Column(String(30))
    verified = Column(Boolean)
    dispatch_id = Column(Integer, ForeignKey("dispatch_records.dispatch_id", ondelete="SET NULL"), index=True)
    dispatch_truck_id = Column(Integer, ForeignKey("dispatch_trucks.dispatch_truck_id", ondelete="SET NULL"), index=True)
    idempotency_key = Column(String(160), unique=True)
    event_metadata = Column(JSONB)


# ---------------------------------------------------------------------------
# Report photos (scene photographs attached to an incident report)
# ---------------------------------------------------------------------------

class ReportPhoto(Base):
    """A photograph attached to an incident report by responding personnel.
    The image bytes live on disk under the backend uploads directory; this row
    records the stored filename so the file can be served and cleaned up."""
    __tablename__ = "report_photos"

    photo_id      = Column(Integer, primary_key=True, autoincrement=True)
    report_id     = Column(Integer, ForeignKey("incident_reports.report_id", ondelete="CASCADE"), nullable=False, index=True)
    file_name     = Column(String(255), nullable=False)   # stored filename on disk
    original_name = Column(String(255), nullable=True)     # client-provided name
    content_type  = Column(String(100), nullable=True)     # e.g. image/jpeg
    created_at    = Column(DateTime(timezone=True), default=_now)

    report = relationship("IncidentReport", back_populates="photos")


# ---------------------------------------------------------------------------
# Token blacklist (logout / invalidation)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Road obstructions
# ---------------------------------------------------------------------------

class RoadObstruction(Base):
    __tablename__ = "road_obstructions"

    obstruction_id = Column(Integer, primary_key=True, autoincrement=True)
    type           = Column(String(50), nullable=False)      # "repair" | "blockade" | "flood" | "accident"
    latitude       = Column(Float, nullable=False)
    longitude      = Column(Float, nullable=False)
    description    = Column(Text, nullable=True)
    # Orientation of the road this was snapped to, degrees clockwise from north
    # in [0, 180). The map draws the obstruction as a bar across the road, which
    # needs the road's angle; storing it avoids re-snapping on every render.
    bearing_deg    = Column(Float, nullable=True)
    is_active      = Column(Boolean, nullable=False, default=True)
    created_at     = Column(DateTime(timezone=True), default=_now)
    expires_at     = Column(DateTime(timezone=True), nullable=True)
    created_by     = Column(Integer, ForeignKey("users.user_id"), nullable=True)


# ---------------------------------------------------------------------------
# GNN constraints (user-drawn narrow roads / traffic areas)
# ---------------------------------------------------------------------------

class GnnConstraint(Base):
    __tablename__ = "gnn_constraints"
    __table_args__ = (CheckConstraint("narrow_severity IN ('slight', 'severe')", name='ck_constraint_narrow_severity'),)

    constraint_id = Column(Integer, primary_key=True, autoincrement=True)
    constraint_type = Column(String(50), nullable=False)   # "narrow_road" | "traffic_area"
    name          = Column(String(255), nullable=True)
    coordinates   = Column(Text, nullable=False)           # JSON array of [lon, lat] pairs
    segment_uids  = Column(JSON, nullable=True)             # NULL = legacy/unresolved
    narrow_severity = Column(String(10), nullable=True)      # NULL preserves legacy regular narrow
    traffic_schedule = Column(JSON, nullable=True)          # NULL preserves legacy traffic behavior
    highway       = Column(String(100), nullable=True)
    surface       = Column(String(100), nullable=True)
    maxspeed      = Column(String(50), nullable=True)
    is_active     = Column(Boolean, nullable=False, default=True)
    created_at    = Column(DateTime(timezone=True), default=_now)
    updated_at    = Column(DateTime(timezone=True), default=_now, onupdate=_now)
    created_by    = Column(Integer, ForeignKey("users.user_id"), nullable=True)


class LoginHistory(Base):
    """One row per successful authentication, for the Security tab's sign-in list.

    Written on the login routes only — a token being *used* is not a login, so
    get_current_user stays read-only and the auth path takes no extra write.
    """
    __tablename__ = "login_history"

    login_id     = Column(Integer, primary_key=True, autoincrement=True)
    user_id      = Column(Integer, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    logged_in_at = Column(DateTime(timezone=True), default=_now)
    ip_address   = Column(String(45))
    user_agent   = Column(String(512))

    user = relationship("Users", back_populates="login_history")


class TokenBlacklist(Base):
    __tablename__ = "token_blacklist"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    jti        = Column(String(64), unique=True, nullable=False, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), default=_now)


class ModelVersion(Base):
    """Durable retrain history; artifacts are immutable, activation is separate."""
    __tablename__ = "model_versions"
    __table_args__ = (
        CheckConstraint("status IN ('training','failed','candidate','scheduled','champion','rejected','archived')",
                        name="ck_model_versions_status"),
        Index("uq_model_versions_training", "status", unique=True,
              postgresql_where=text("status = 'training'"), sqlite_where=text("status = 'training'")),
        Index("uq_model_versions_champion", "status", unique=True,
              postgresql_where=text("status = 'champion'"), sqlite_where=text("status = 'champion'")),
    )

    version = Column(String(64), primary_key=True)
    status = Column(String(20), nullable=False)
    label_hash = Column(String(64), nullable=False)
    split_version = Column(String(100), nullable=False)
    threshold = Column(Float, nullable=True)
    metrics = Column(JSON, nullable=True)
    report = Column(JSON, nullable=True)
    job_id = Column(String(64), unique=True, nullable=True)
    champion_version = Column(String(64), nullable=True)
    bundle_manifest_sha256 = Column(String(64), nullable=True)
    error = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.user_id"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=_now, onupdate=_now)
    promoted_by = Column(Integer, ForeignKey("users.user_id"), nullable=True)
    promoted_at = Column(DateTime(timezone=True), nullable=True)
    rejected_by = Column(Integer, ForeignKey("users.user_id"), nullable=True)
    rejected_at = Column(DateTime(timezone=True), nullable=True)


# ---------------------------------------------------------------------------
# Barangay boundaries (PostGIS)
# ---------------------------------------------------------------------------

class BarangayBoundary(Base):
    __tablename__ = "barangay_boundaries"

    brgy_id            = Column(Integer, primary_key=True, autoincrement=True)
    brgy_name          = Column(String(255), nullable=False)
    brgy_estpopulation = Column(Integer, nullable=True)
    brgy_polygon       = Column(Geometry("POLYGON", srid=4326), nullable=False)

    fire_incidents = relationship("FireIncident", back_populates="barangay")
