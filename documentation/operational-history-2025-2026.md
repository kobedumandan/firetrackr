# Operational demonstration history, December 2025–November 2026

Applied to the configured local `bfp_capstone` database on November 10, 2026,
following the user's request to replace every 2026 incident with a sparse,
complete operational dataset. The 78 BFP station incidents from 2023–2024,
their exact CSV coordinates/barangays and the team's alarm annotations remain
unchanged. The database now contains 115 incidents.

The operation removed all 22 previous 2026 incidents and their linked dispatches,
routes, reports, photo references, events and incident-associated GPS samples.
Referenced local photos were copied into the backup folder; original upload
files were preserved. Team/truck/member flags held by removed assignments were
released after checking that no ongoing dispatch or unfinished return remained.
Accounts, roster membership, stations, shifts, road data and configurations were
preserved. No schema migration was performed.

## Generated records

All 37 new incidents are closed and classified as `record_kind=operational`.
User-facing addresses, remarks and reports contain natural incident descriptions
without test/simulation prefixes. Internal `history_entry` and `history_manifest`
audit events retain batch `history_population_20261110`, the generator name and
`data_origin=generated_for_demonstration`. These records are generated examples;
their response measurements, GPS and reports are not observations from BFP.

| Month | Incidents |
| --- | ---: |
| December 2025 | 3 |
| January 2026 | 4 |
| February 2026 | 2 |
| March 2026 | 5 |
| April 2026 | 3 |
| May 2026 | 0 |
| June 2026 | 4 |
| July 2026 | 2 |
| August 2026 | 6 |
| September 2026 | 3 |
| October 2026 | 4 |
| November 1, 2026 | 1 |

The locations use reviewed address/street candidates from the supplied BFP CSV,
including Dapco, Nanyo, Cagangohan, New Visayas, Gredu and other Panabo barangays.
Individual house-lot and named institution references are generalized to their
source street/area. Routing must reach within 300 metres of each incident point.
All new points pass the frontend's municipal outline and have named barangay IDs.
Causes use the CSV's actual cause categories.

The later same-day route-history refresh moved the 37 generated points by
35–106.7 metres within their original barangay polygons. Each now has a distinct
coordinate, separate from both the other generated points and the BFP history.
Addresses, barangay labels/IDs, dates, timings, reports and all 78 BFP records
were preserved. Heatmap points, saved outgoing/return routes, route snapshots
and GPS were updated consistently with the new locations.

The existing Panabo routing engine computes directed outgoing and return routes
on the digitized road network. Outgoing routes retain saved WKT geometry,
distance, ETA, selected-route/departure snapshots and two route-revision examples.
GPS samples follow those computed outgoing paths. Historical travel times vary
around route ETAs and include turnout, processing, suppression, clearance,
independent operation completion, truck return and readiness timestamps.

The batch contains 44 dispatches/truck assignments, 47 saved outgoing route
options, 44 field reports and 37 reviewed consolidated
reports. Current crews are used as historical scenario participants, with saved
assignment/role/shift/station snapshots. Four Panabo teams from three stations
and both shifts are represented; no New Corella response is generated.

The refreshed history has 7,691 vehicle GPS samples and 16,534 attributed member
GPS samples across 99 connected responder tracks. Tracks sample the actual road
geometry every ten seconds and at every geometry corner. The earlier two-point
member history was insufficient: departure-to-arrival gaps exceeded the route
view's 120-second continuity guard. The generator now saves full member tracks
in `dispatch_locations`, separately from vehicle records in `truck_logs`.

Response Analysis now offers a Team selector inside Recorded responder routes,
synchronized with its responding-dispatch picker, truck comparison and evidence.
Seven generated incidents have two responding teams; the others have one.

## Verification and backups

`backend/seed_operational_history.py` contains the generator and transactional
replacement functions. The task runner and artifacts are in the parent
workspace's `local-backups/operational-history-20261110/` directory. The runner
first builds a reviewed route/date plan, makes and lists a full database backup,
then restores it into a disposable database. Only after the full rehearsal passes
does it replace the configured local database in one transaction.

Checks verified preservation of the BFP imports and unrelated data, 0–6 incidents
per month, no old 2026 incidents, complete chronological response stages, fully
returned/ready trucks, natural display text, complete reports, saved route/GPS
details, 99 personnel-assignment rows and 44 eligible ETA comparisons. Response
and Operations charts, team/shift comparisons, personnel deployment, fire-prone
areas, metrics and the register all return the intended population. Station
coverage computation produces the existing 3/5/8-minute bands and barangay gaps.

The running API returned 115 register records, 115 heatmap points and 37 incidents
for December 1, 2025–November 1, 2026, with no active incidents. Use that custom
date window or All time to inspect the history. Filters after November 1 contain
no new generated incidents, consistent with the requested cutoff.

Backups, the untouched source CSV, reviewed plan, rehearsal/application results,
resource-normalization snapshot and live API verification remain local in the
artifact folder. No emails, SMS, push notifications or live personnel GPS updates
were sent during generation. Existing uploaded images and unrelated source
changes were not deleted or committed.

The GPS/point refresh has its own verified full backup, reviewed plan,
restored-copy rehearsal, application result and live verification under the
parent workspace's `local-backups/responder-tracks-20261110/` directory. Checks
confirmed 37 unique generated points, all 99 connected personal tracks without
excluded samples or continuity gaps, all 44 eligible ETA comparisons, unchanged
addresses/barangays, and preserved reports/timestamps/resources and BFP data.
The frontend build and focused team-switching/synchronization tests passed.
Existing repository lint errors and an unrelated Response Analysis test's
preceding-window capitalization mismatch remain.
