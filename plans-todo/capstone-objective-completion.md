# Capstone objective completion plan

The Response Performance and Operational Times tabs have since been combined as
**Analysis > Response & Operations**. See the implementation guide below for the
current shared filters, measurement populations, quality rules and CSV reviews.

Prepared: 2026-10-24 (Asia/Singapore). Status: implemented in the original web and
mobile checkouts; physical-phone acceptance remains pending. See
[implementation and review guide](../documentation/capstone-objectives-implementation.md).

Migration 0031 was tested on disposable PostGIS, then applied to the original
loopback `bfp_capstone` database after a verified custom-format backup. Existing
row counts, including 214 incidents, were preserved. No historical operation
endpoints or deployment rosters were fabricated. No model or environment values
were changed, and no commits or pushes were made.

The implementation uses audited assignment intervals inside the existing dispatch
JSON context, rather than adding a separate association table. Verified milestones
remain immutable through the current UI. A renewed operation requires a new
incident; operation episodes and an administrator timestamp-correction workflow
remain follow-up work. Retention policy and unattended next-shift wake-up remain
deployment decisions, as described below.

## Scope and decisions

This plan follows the manuscript objective assessment and the user's decisions:

- Add location transmission every 30 seconds outside an active dispatch, for
  on-duty personnel only. Preserve the faster active-dispatch cadence.
- Treat GAT as the selected model, based on the user's report that GAT,
  GraphSAGE, and GCN were evaluated before the last defense and GAT performed best.
  Repeating model selection is not a dependency for this work. Link the final
  manuscript comparison to the actual defense experiment and retained artifacts;
  the separate notebook threshold-selection finding remains a provenance check.
- Complete overall operation time, personnel deployment reporting, and a
  reportable fire-prone-area ranking consistent with the heatmap's severity scale.
- Overall operation time is report received -> operation complete/all units
  cleared, as explicitly selected by the user during planning.
- Integrate mobile milestone actions and GPS accuracy/sample IDs into the original
  mobile application, then validate the complete workflow on physical phones.

The backend/web target is the original `firetrackr` checkout. The mobile target is
`../firetrackr_mobile`. Review the six changed files in
`../firetrackr-mobile-response-performance` and port the relevant changes deliberately;
do not replace whole repositories or lose existing local changes.

The existing [response-performance plan](response-performance.md) documents the
already implemented baseline. This document describes the additional work.

## Verified starting points

| Area | Existing source and behavior |
| --- | --- |
| Duty roster | `backend/shift_utils.py`: alternating A/B shifts, 08:00 Asia/Manila handover; personnel have `shift_id`. |
| Mobile tracking | `../firetrackr_mobile/hooks/useLocationTracking.js` and `tasks/locationTask.js`: active dispatch only; 3 seconds dispatched/en route, 20 seconds on scene; background task with foreground fallback. |
| Mobile status/API | `backend/routers/mobile.py`: status has assigned shift but no explicit duty eligibility; location body currently requires a dispatch ID. |
| Location persistence | `CurrentLocation` is attributed but overwritten. Legacy `LocationLog` has no direct personnel identity or device event time for phone samples. `DispatchLocation` requires a dispatch. |
| Analytics | Operational Times has processing, preparation, travel, suppression and call-to-arrival; Response Performance has dispatch and team observations plus CSV export. |
| Assignment history | Dispatch `context_snapshot` preserves team/station/shift/truck context, but not the deployed personnel roster. |
| Completion | Filing a report closes an incident and completes the submitting dispatch. Direct status closure also releases resources. These administrative actions do not establish the physical operation end time. |
| Heatmap/rankings | Closed incident heatmap uses weights 0.4/0.7/1.0 and unknown fallback 0.5; current barangay ranking counts incidents without severity weighting. |
| Mobile integration | Review worktree adds acknowledge/depart controls, event refreshes and GPS accuracy/sample IDs. Those changes are absent from the original mobile checkout. |

## Phase 1: Server-authoritative on-duty tracking

### Eligibility and cadence

| Authentication / duty / dispatch | Location mode | Target transmission interval |
| --- | --- | --- |
| Signed out, expired or revoked session | Off | No transmission |
| Off duty, unknown/unassigned shift, or unresolved duty eligibility | Off | No transmission |
| On duty, no active assigned dispatch | Standby | 30 seconds |
| On duty, assigned dispatched/en-route response | Dispatch | 3 seconds |
| On duty, assigned on-scene response | On scene | 20 seconds |

On duty means the authenticated personnel's assigned shift matches the backend's
current roster. Normalize shift naming through the existing helper. An explicit
off-duty membership state suppresses tracking; conflicting memberships require a
deterministic policy and must not use whichever row happens to be first. Do not
copy the dashboard's permissive assumption that an unassigned shift is on duty.
Personnel without a team can still send standby fixes if their personnel shift
confirms duty. A team shift alone must not silently override the personnel roster.

The duty gate applies to active dispatches as well. At handover an off-duty phone
stops tracking even if a dispatch remains active; retain the dispatch record and
show the reason. Any future duty extension needs an explicit server-side policy,
not a client-side exemption. Do not automatically clear dispatches at shift end.

### Backend contract

1. Add a shared duty/tracking-policy service, using `shift_utils.py`, consumed by
   status, location ingestion and relevant administrator views. Expose additive
   status fields such as `tracking.mode`, `interval_ms`, `reason`, `server_time`,
   `duty_ends_at`, and `policy_expires_at`. Use a short renewable policy lease,
   proposed at two minutes and capped at duty end, so cached permission cannot
   authorize indefinite collection during an outage.
2. Make `LocationUpdateBody.dispatch_id` optional for standby. Derive personnel
   identity from the JWT, validate finite/ranged coordinates and timestamps, and
   accept accuracy and stable sample IDs. Check current duty before persisting or
   broadcasting any sample. Also verify that the device event time belongs to the
   authorized duty interval; delayed off-duty samples must not enter history.
3. For a supplied dispatch ID, verify assignment membership and an active status.
   Never silently attach a mismatched sample to another dispatch. Return an
   authoritative tracking directive so the updated client can transition to
   standby or stop. Preserve legacy dispatch-client response semantics where
   practical and test the old payload contract explicitly.
4. Route standby fixes only through personnel current-location/history writes and
   the existing personnel-location broadcast. Do not feed them into truck syncing,
   route deviation, dispatch GPS history or automatic vehicle milestones.
5. Extend `LocationLog` additively with nullable personnel identity, device event
   time, accuracy, collection mode and a deduplication key for attributed phone
   samples. Preserve existing IoT rows and unknown historical attribution. Use a
   unique key scoped to personnel and sample, and persist same-key retries once.
   Reuse the current-location race winner rules for out-of-order samples. Keep
   `DispatchLocation` for valid dispatch-associated samples.
6. Fix status dispatch resolution to inspect all memberships before deciding that
   a personnel has no active dispatch; its current early break can stop at a
   standby team. Handle multiple active assignments deterministically and expose
   ambiguity rather than guessing vehicle occupancy.

### Mobile behavior and lifecycle

1. Pass the server policy from `AuthContext` to the tracking hook. Use one shared
   policy/transition helper for foreground and headless paths, with a single owner
   for GPS and posting. Transition dispatch -> standby when a response completes;
   transition immediately to off when duty/session eligibility ends.
2. Persist only the session and policy context needed for the headless task in
   SecureStore. Check duty-end/policy expiry before obtaining or transmitting new
   fixes, stop native updates at expiry, and renew eligibility while running.
   Headless dispatch completion must fetch/reconcile policy itself; React status
   polling may be suspended while the phone is locked.
3. Handle a task that starts late, task startup completing after logout, changed
   accounts, stale fetch replies, interval changes and foreground/background
   overlap with generation guards and awaited native start/stop operations.
4. Clear cached fixes on account, duty or dispatch changes. Send the newest valid
   fix with its original timestamp; do not repeatedly upload an old position as
   current. Capture accuracy and a stable sample ID in both foreground and task
   payloads. Only one path should transmit a sample.
5. Stop native tracking and remove persisted tracking context on logout, revoked
   session, denied permission, off duty or expired policy. A network outage is not
   permission to collect past the policy lease. Start fresh after eligibility is
   restored; initial scope does not add an offline GPS backlog.
6. Recheck policy at login, app activation, authenticated status events and normal
   refreshes. Once GPS is stopped off duty, automatic restart with a suspended app
   must not be promised: next-shift activation is guaranteed on app foreground;
   OS background wake/push can provide best-effort refresh. Unattended restart is
   a separate native scheduling requirement if required by BFP.
7. Update Home/Settings state, permission descriptions in `app.json`, and background
   notification wording to describe on-duty location sharing. Distinguish sharing,
   standby, off duty, permission denied, reconnecting and last successfully sent.
   Cadences are targets; actual screen-lock/background delivery must be measured.

Show off-duty personnel's retained location as last known with a timestamp, never
as live. Use the shared backend duty result in dashboard roster/map displays and
invalidate cached eligibility at handover or roster edits.

## Phase 2: Complete mobile dispatch evidence

- Port acknowledge/depart API helpers, eligible-role controls and event refreshes
  from the mobile review worktree into the original app. Retain server timestamp
  semantics and idempotent retries; do not label an unsent offline tap confirmed.
- Port GPS accuracy/sample fields first, then apply Phase 1's policy changes to
  both foreground and background senders so those additions survive the refactor.
- Preserve explicit truck-manning requirements. A personnel fix does not prove
  occupancy. Suppression start/fire-out remain human confirmations.
- On departure preserve the selected route, prediction and origin known at that
  time. Later rerouting must not rewrite the original prediction comparison.
- Keep GPS milestone automation disabled until physical-device acceptance passes.

## Phase 3: Overall operation time and ETA reporting

### Metric definitions

| Metric | Definition |
| --- | --- |
| Preparation / turnout | Unit or dispatch departure minus dispatch timestamp; retain explicitly labeled observation level. |
| Travel | Arrival minus departure for the same unit/dispatch. |
| Total service response | First eligible arrival minus report receipt, once per incident. |
| Dispatch response | Arrival minus dispatch, labeled separately from total service response. |
| Suppression | Fire out minus suppression start, for fire responses. |
| Overall operation | Operation complete/all units cleared minus report receipt, once per incident. Confirmed by the user. |

Do not add independently averaged stage values to produce overall operation time.
Arrival-to-suppression and post-fire-out clearance gaps can exist. Compute the
interval from the actual endpoints. Missing endpoints yield unavailable or pending
with a reason; canceled/recalled, test/drill, demo and invalid chronology stay
explicitly classified. Do not apply the existing six-hour response review guard to
overall operations: multi-day operations can be valid.

Add `operation_completed_at` and an audited,
idempotent completion milestone. Require eligible dispatches to have cleared;
support authenticated leader confirmation of their own dispatch clearance and
administrator confirmation/correction of the incident endpoint. Keep server
receipt time separate from the asserted event time. Administrative report filing
or incident status closure must not silently supply this physical end time.
Define reopening as an explicit new operation episode if an already completed
incident resumes; retain prior completion events and avoid silently changing a
published operation interval. Verify any new fields/milestones against existing
closure, multi-team release and reporting paths together.

Extend the shared analytics service, Operational Times cards/trends/details and
CSV output with the same definitions and quality counts. Show a complete incident
lifecycle while keeping per-unit and per-incident populations separate.

For ETA reporting, reuse existing comparable-trip rules: reliable departure fix,
matching planned origin, saved prediction, positive ETA and valid actual travel.
Expose signed error (actual minus predicted), absolute error, MAE, median absolute
error and eligible/excluded counts with reasons. Percentage error is available
only for positive prediction values and must state its denominator. No arbitrary
single 'accuracy percentage' or claim of field calibration. Apply equal filters
to cards, detail rows and CSV; historical/demo predictions are not actual evidence.

## Phase 4: Personnel deployment summary

1. Add an immutable roster snapshot when manual or automatic dispatch assigns a
   team: personnel ID, displayed name/rank, role and assignment context. Prefer an
   explicit dispatch-personnel association with assignment/release intervals and
   audited membership changes. Keep the existing team context snapshot intact.
2. Define an assignment count as a personnel-dispatch assignment and incident
   count as distinct fire IDs. Separate assigned, acknowledged/confirmed where
   available, completed and canceled deployments. Show unknown attendance rather
   than treating GPS or team membership as proof of participation.
3. Add an administrator report with date, personnel, team, station, shift and record
   kind filters; provide assignments, unique incidents, role breakdown, deployment
   duration coverage, active assignments and detail rows. Duration uses recorded
   assignment/release endpoints, not the current roster. Clip durations for a
   selected reporting window and merge overlaps before counting personnel-hours.
4. Legacy dispatches without a roster snapshot show unknown personnel attribution;
   never reconstruct historical crews from today's team. Preserve snapshot labels
   after transfers, membership edits or account removal under existing deletion
   policy. Counts must not multiply across truck/location joins.
5. Add a Personnel Deployment view within Analysis and a full filtered CSV export
   using the existing preview pattern. Incident-history exports remain accessible;
   include new timing fields through shared serializers where applicable.

## Phase 5: Severity-weighted fire-prone-area report

- Add an administrator service/API and Analysis > Operational Reports ranking table for Panabo barangays
  with incident count, severity counts, missing-severity count, weighted score,
  location-quality counts and explicit ranking ties.
- Use `sum(severity_weight(incident.fire_severity))`, sharing the heatmap helper
  and its existing unknown weight 0.5. Each eligible incident contributes once.
  Label unknown contributions and offer a known-severity-only view. Do not equate
  alarm levels with recorded severity or silently change the weighting scheme.
- Use a common eligible historical incident selector for heatmap and weighted
  report: closed incidents represented in the heatmap history, matching date,
  record-kind/source and Panabo boundary filters. Resolve unknown-kind imported
  history explicitly rather than automatically labeling it operational. Exclude
  synthetic drill/test fixtures from the historical report by default and make
  unknown/imported source inclusion visible.
- Assign each incident to at most one barangay using the known FK, then the
  existing permitted spatial fallback for legacy records. Keep unresolved imported
  barangays unassigned. Estimated historical pins remain clearly marked and do not
  establish verified property-level clusters. Publish unassigned counts.
- Rank by descending weighted score with competition ranks for ties and stable
  barangay-name ordering. Keep frequency ranking available, label the selected
  measure, and export the same filtered population and formula shown on screen.
- Describe the result as historical fire concentration; no future-fire probability,
  population-normalized rate or risk threshold is implied by this score.

## Delivery sequence and validation

1. Implement backend duty policy, additive status/location contracts and attributed
   standby storage. Test backwards compatibility before changing the client.
2. Integrate mobile evidence changes and duty-aware foreground/headless tracking.
3. Implement the confirmed operation endpoint/milestones and shared analytics;
   add ETA aggregate reporting.
4. Implement assignment snapshots and deployment reports, then shared historical
   filtering and weighted barangay reports.
5. Exercise all slices together on an isolated PostGIS database and physical phones;
   update implementation documentation and manuscript evidence from actual results.

Add new Alembic revisions after the actual migration head at implementation time
(currently source chain through 0030); never reuse IDs from response-only review
worktrees. Review SQL, upgrade/rollback/re-upgrade on disposable PostGIS, then
prepare a backup and concrete migration instructions for the intended database.
Do not seed operational databases or run writing tests against them.

| Acceptance area | Required evidence |
| --- | --- |
| Duty boundaries | Both A/B shifts; 07:59:59/08:00 handover; normalized names; unassigned/off-duty personnel; roster changes; active dispatch crossing handover. |
| Tracking contract | Auth/ownership denial; null-dispatch standby; old-client dispatch payload; wrong-team dispatch; all-membership resolution; finite coordinates; deduplication; out-of-order and delayed fixes. |
| Side effects | Standby updates personnel only; no truck movement, route changes, dispatch evidence or GPS milestones. Off-duty sample creates no history/current-location/broadcast. |
| Lifecycle | 30/3/20-second targets; standby -> dispatch -> on scene -> standby; logout and immediate account switch; stale in-flight reply; delayed task startup; duplicate task prevention. |
| Background phone | Screen lock, app switch, permission refusal/revocation, session expiry, network loss, policy expiry, shift boundary while offline and next-shift foreground restart. Record device/OS/build and actual arrival gaps. |
| Operation | Multi-team clearances; report submission later than physical end; missing endpoints; cancellation; valid long operations; correction/reopening audit; incident counted once. |
| Deployment | Historical roster survives transfers; no fabricated legacy crew; distinct incidents vs assignments; overlap duration; filters and CSV match. |
| Rankings | Mixed/unknown severity; duplicate heatmap entries; tied scores; date boundaries; estimated/unresolved locations; fixture exclusion; map/report/CSV cohort parity. |
| ETA | Saved route survives reroute; unmanned/poor-accuracy/mismatched-origin exclusions; positive-ETA guard; aggregate values agree with eligible detail rows. |

Run focused backend and frontend regressions plus frontend build/lint as appropriate;
distinguish baseline lint findings from new failures. Phone acceptance is a separate
gate from automated tests. At a 30-second target a full 24-hour standby shift can
produce about 2,880 samples per person; measure data/battery impact and establish
a retention period before deployment. No automatic purge is authorized here.

## Completion evidence for the manuscript

- Objective 1: on-duty standby and dispatch GPS demonstration, timestamped sample
  delivery measurements and verified off-duty stop behavior.
- Objective 2: shared severity formula, historical data provenance, map/report
  examples and unknown-severity/location limitations.
- Objective 3: retain the defense comparison and chosen GAT artifacts; describe
  exported GAT constraint costs and ALT routing accurately.
- Objective 4: retain administrator create/edit/remove/expiry and routing-refresh
  demonstrations from the existing constraint implementation.
- Objective 5: lifecycle and operation metrics, personnel deployment/incident
  history/area-ranking exports and ETA comparisons based on eligible recorded trips.

An implementation checklist is not proof of measured BFP performance. Record which
checks use synthetic fixtures and which use actual observed operations.
