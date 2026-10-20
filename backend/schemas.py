"""Request/response models shared by the routers."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class RouteRequest(BaseModel):
    source_node: int
    target_node: int


class RouteResponse(BaseModel):
    route_nodes: list[int]
    eta_seconds: int
    gnn_confidence: float
    route_wkt: str
    computation_ms: float


VALID_CONSTRAINT_TYPES = ("narrow_road", "traffic_area")


class ConstraintCreate(BaseModel):
    constraint_type: str
    name: str | None = None
    coordinates: list          # [[lon, lat], [lon, lat], ...]
    highway: str | None = None
    surface: str | None = None
    maxspeed: str | None = None


class ConstraintUpdate(BaseModel):
    name: str | None = None
    coordinates: list | None = None
    constraint_type: str | None = None
    highway: str | None = None
    surface: str | None = None
    maxspeed: str | None = None


class LoginRequest(BaseModel):
    email: str
    password: str


class ProfileUpdate(BaseModel):
    """A partial patch of the signed-in user's own profile.

    Every field is optional and read with exclude_unset, so the Settings page can
    save one row at a time without echoing back values it isn't changing.
    """
    # Deliberately a pattern rather than pydantic's EmailStr: that pulls in the
    # email-validator package, which isn't a dependency of this project.
    email: str | None = Field(
        default=None, min_length=3, max_length=255,
        pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    first_name: str | None = Field(default=None, min_length=1, max_length=100)
    last_name:  str | None = Field(default=None, min_length=1, max_length=100)
    # "No letters" is the rule the personnel/station modals already enforce on
    # contact numbers; keep this endpoint consistent with them.
    contact: str | None = Field(
        default=None, min_length=7, max_length=50, pattern=r"^[0-9 ()+\-]+$")


class PasswordChange(BaseModel):
    current_password: str
    # 8 is the floor the frontend also enforces; keep them in step.
    new_password: str = Field(min_length=8, max_length=128)


class PersonnelUpdate(BaseModel):
    per_firstname:   str | None = None
    per_lastname:    str | None = None
    per_contact:     str | None = None
    per_rank:        str | None = None
    per_designation: str | None = None
    station_id:      int | None = None
    shift_id:        int | None = None
    user_email:      str | None = None
    user_password:   str | None = None


class PersonnelCreate(BaseModel):
    per_firstname:   str
    per_lastname:    str
    per_contact:     str | None = None
    per_rank:        str
    per_designation: str | None = None
    station_id:      int | None = None
    user_email:      str
    user_password:   str
    user_role:       str = "personnel"


class StationCreate(BaseModel):
    station_name: str
    station_type: str = "main"
    parent_station_id: int | None = None
    station_address: str
    station_barangay: str
    station_latitude: float
    station_longitude: float
    station_contact: str
    station_status: str = "operational"


class StationUpdate(BaseModel):
    station_name:         str | None = None
    station_type:         str | None = None
    parent_station_id:    int | None = None
    station_address:      str | None = None
    station_barangay:     str | None = None
    station_latitude:     float | None = None
    station_longitude:    float | None = None
    station_contact:      str | None = None
    station_status:       str | None = None
    station_commander_id: int | None = None


class TeamCreate(BaseModel):
    team_name:  str
    team_code:  str | None = None
    team_status: str = "standby"
    station_id: int | None = None
    shift_id:   int | None = None
    truck_id:   int | None = None


class TeamUpdate(BaseModel):
    team_name:  str | None = None
    team_code:  str | None = None
    team_status: str | None = None
    station_id: int | None = None
    shift_id:   int | None = None
    truck_id:   int | None = None


class TeamMemberBody(BaseModel):
    per_id:        int
    member_role:   str | None = None
    member_status: str | None = None


class TeamMemberRoleUpdate(BaseModel):
    member_role:   str | None = None
    member_status: str | None = None


class ObstructionCreate(BaseModel):
    type:        str
    latitude:    float
    longitude:   float
    description: str | None = None
    expires_at:  str | None = None


class ReporterLocationBody(BaseModel):
    lat: float
    lng: float
    accuracy: float | None = None


class ReporterSmsBody(BaseModel):
    phone_number: str


DispatchType = Literal[
    "Fire Safety Enforcement",
    "Firefighting Operations",
    "Emergency Medical Services (EMS)",
    "Special Operations",
    "Fire/Arson Investigation",
    "Disaster Management",
]


class IncidentCreate(BaseModel):
    record_kind: Literal['operational', 'drill', 'test', 'unknown'] = 'unknown'
    report_received_at: datetime | None = None
    response_kind: Literal['fire', 'medical', 'rescue', 'other'] | None = None
    fire_location_name:  str | None = None
    fire_address:        str | None = None
    fire_latitude:       float
    fire_longitude:      float
    fire_severity:       str = "Minor"
    fire_status:         str = "pending"
    fire_alarm_level:    str | None = None
    fire_dispatch_type:  DispatchType = "Firefighting Operations"
    fire_structure_type: str | None = None
    fire_casualties:     str | None = None
    fire_units_assigned: int = 0
    fire_reporter_name:  str | None = None
    fire_reporter_contact: str | None = None
    fire_location_source: str = "manual"
    fire_remarks:        str | None = None
    # When the fire actually happened, for incidents recorded after the fact
    # (logbook backfill, calls handled while offline). Omitted → now.
    fire_incident_datetime: datetime | None = None
    auto_dispatch:       bool = False
    # When the incident was logged from a reporter pin, the session token so the
    # transient location can be cleared (it's now persisted as an incident).
    reporter_token:      str | None = None


class IncidentUpdate(BaseModel):
    record_kind: Literal['operational', 'drill', 'test', 'unknown'] | None = None
    fire_location_name:  str | None = None
    fire_address:        str | None = None
    fire_severity:       str | None = None
    fire_status:         str | None = None
    fire_alarm_level:    str | None = None
    fire_dispatch_type:  DispatchType | Literal[""] | None = None
    fire_structure_type: str | None = None
    fire_casualties:     str | None = None
    fire_units_assigned: int | None = None
    fire_reporter_name:  str | None = None
    fire_reporter_contact: str | None = None
    fire_remarks:        str | None = None


class DispatchCreate(BaseModel):
    fire_id:  int
    team_id:  int


class SelectRouteBody(BaseModel):
    route_id: int


class LocationUpdateBody(BaseModel):
    accuracy_m: float | None = Field(None, ge=0, allow_inf_nan=False)
    sample_id: str | None = Field(None, max_length=80)
    latitude:    float
    longitude:   float
    recorded_at: str          # ISO 8601 from device clock
    dispatch_id: int
    battery:     int | None = None


class PushTokenBody(BaseModel):
    token:         str = Field(..., min_length=10, max_length=255)
    platform:      str | None = Field(None, max_length=20)
    sound_enabled: bool = True


class PushTokenRef(BaseModel):
    token: str = Field(..., min_length=10, max_length=255)


class TruckManningBody(BaseModel):
    manning: bool


class OperationalMilestoneBody(BaseModel):
    kind: Literal['receipt', 'departure', 'arrival', 'suppression_start', 'fire_out', 'classification']
    occurred_at: datetime
    dispatch_truck_id: int | None = None
    response_kind: Literal['fire', 'medical', 'rescue', 'other'] | None = None
    idempotency_key: str = Field(min_length=8, max_length=100)


class TruckCreate(BaseModel):
    truck_platenum: str
    truck_status: str = "available"
    station_id: int | None = None


class TruckUpdate(BaseModel):
    truck_platenum: str | None = None
    truck_status: str | None = None
    station_id: int | None = None
