# Review Analysis with synthetic data

Use the original `firetrackr` checkout with the local `firetrackr_analysis_review`
database. It contains a copy of the original data plus **24 synthetic test
incidents, 40 dispatches, 80 routes and 8 invented GPS samples**. It retains the
original accounts, four stations and 40 barangay boundaries. The original
`bfp_capstone` database and both app `.env` files are unchanged.

All added incidents have `record_kind=test`, source `analysis_review_v1`, and
`SYNTHETIC TEST` addresses. Their audit events are explicitly unverified synthetic
fixtures. Times, routes and GPS are invented to exercise the software; they are
not BFP performance measurements or evidence of routing accuracy.

## Run the app

Stop your current backend with **Ctrl+C**, then run:

```powershell
cd "C:\Software Projects\firetrackr_local_master-folder\firetrackr\backend"
& ".\venv\Scripts\python.exe" analysis_review.py run
```

The launcher uses port 8000 and the original code. It overrides the database only
for its own process, disables SMS/GPS automation, and refuses to start if phone
push tokens are present. No phone tokens were copied into the review database.

Keep the original frontend running, or start it in another terminal:

```powershell
cd "C:\Software Projects\firetrackr_local_master-folder\firetrackr\frontend"
npm.cmd run dev -- --port 5173 --strictPort
```

Open <http://localhost:5173>, reload the page and sign in with your **usual admin
account**. The database copy has the passwords that existed when it was prepared.

## Response Performance

Open **Analysis > Response Performance**:

1. Set **Record kind** to **test**, leave teams unselected and other filters at
   All, keep the default date range, and click Refresh.
2. Expect **40 dispatches**. The overall card has **19/24 valid**, one pending,
   one missing, two invalid and one excluded. After-dispatch has **36/40 valid**,
   one pending, two invalid and one excluded.
3. The two teams are **Analysis Alpha (TEST)** and **Analysis Bravo (TEST)**.
   Select one team: dispatch cards/table change; overall first arrival stays the
   same. Clear selection to restore both teams.
4. Three recent months contain trend samples. Select a month and compare its
   table with CSV export. Clear the month selection before expecting 40 rows.
5. Try station, severity and barangay filters. CSV rows should match the filtered
   table total across all pages, rather than just the current page.
6. Open the newest synthetic baseline incident, named **TEST 00: Baseline**.
   In the prepared local batch it is **INC-1022**, dispatch **397 (Alpha)** and
   **398 (Bravo)**. IDs can differ if preparing a new copy elsewhere.

The baseline has these exact expected intervals:

| Measurement | Alpha | Bravo |
| --- | --- | --- |
| Receipt to arrival | 8 min | 12 min |
| Dispatch handling | 1 min | 2 min |
| Acknowledgement | 30 sec | 30 sec |
| Turnout, including acknowledgement | 2 min | 3 min |
| Travel | 5 min | 7 min |
| After dispatch | 7 min | 10 min |

Bravo is a reinforcement. Both dispatches have two route revisions: route 2 was
selected at departure, then route 1 was selected later. Departure details must
retain route 2. Each unit has four synthetic GPS points in **two segments**,
with a deliberate gap. The saved ETA is 4 minutes for Alpha and 6 for Bravo;
actual travel is 60 seconds longer in each case. Alpha's comparison is +25%;
Bravo's is about +16.7%.

Other named scenarios exercise missing receipt, pending arrival, cancellation,
travel above six hours, invalid legacy chronology, medical response without
suppression, missing departure and missing acknowledgement. Missing receipt
still permits dispatch-to-arrival measurement. Invalid/excluded observations
remain inspectable and do not enter Response Performance averages.

## Operational Times

Open **Analysis > Operational Times**, choose **All** and **recorded**. In this
isolated database, the synthetic fixtures deliberately populate the stored
timestamp columns to exercise this mode. The existing imported-history demo
selector is a separate population; it is not the switch for these fixtures.

There are **238 incidents** in the prepared copy, including the original 214.
Some original records still have no timing data. Open **INC-1022** in the table
to check processing **1 min**, preparation **2 min**, travel **5 min**,
suppression **15 min**, and call-to-arrival **8 min**. The medical scenario has
suppression **N/A**. Review period changes, trend sample counts, pagination and
the unit routes/GPS in the detail modal.

The six-hour review guard belongs to Response Performance. Operational Times
currently retains nonnegative stored durations, including the deliberately long
scenario; its population and aggregation rules differ.

## Coverage Planning

Open **Analysis > Coverage Planning**, click **Recompute**, switch between
**3 / 5 / 8 minutes**, and export the gap table. It uses the real local road
graph and copied stations/boundaries; invented incident routes do not drive
coverage. Expect **40 barangays** and percentages that stay the same or increase
as the time band widens. In this dataset, three station locations snap to the
Panabo graph; the New Corella station lies outside it.

Validation exposed a display-simplification bug that could reduce coverage by
0.1 percentage point in wider bands. Coverage percentages now use the full
cumulative polygons; simplified map polygons also retain the narrower bands.

## Return to the working database

Stop the review backend with Ctrl+C and use the ordinary launcher:

```powershell
& ".\venv\Scripts\python.exe" run.py
```

Reload/sign in again. No `.env` edits, database restoration or cleanup are needed.
Review edits remain in the isolated database; rerunning `prepare` preserves the
existing fixture batch and does not reset edits or create duplicates.

To prepare the same setup on another local copy at migration 0028:

```powershell
& ".\venv\Scripts\python.exe" analysis_review.py prepare
```

This clones the loopback database configured in this checkout's `.env` only when
the fixed review database is absent, then seeds it in a single transaction. It
never drops/replaces an existing database. Keep this copied database private just
like the original: it includes existing account hashes and incident records.

## Checks performed

Authenticated HTTP checks passed for exact baseline durations, quality counts,
team-independent overall arrival, reinforcement flags, CSV/table agreement under
filters/date windows, preserved departure routes, GPS gaps, ETA comparisons,
operational details/summary/pagination, medical N/A, and all 40 barangay coverage
percentages across 3/5/8-minute bands. Unauthenticated analytics was rejected.
Repeated preparation added no duplicates, and original table counts were unchanged.
A focused coverage regression test and Python syntax checks passed. These checks
do not replace Android field testing, which remains deferred.
