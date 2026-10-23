# Legacy feature migration history

These two files are preserved byte-for-byte from `feature/command-map-layers`.
They are outside Alembic's active `versions/` directory because they reused
main's revision IDs `0025` and `0026` for different changes. Loading both sets
would make the migration graph ambiguous.

The active chain is main's unchanged history: `0025` adds constraint segment
identities, `0026` adds the model registry, `0027` adds operational timing, and
`0028` adds response performance. Fresh databases and databases already on that
main chain use the normal upgrade workflow.

A database migrated with the old feature files needs a separate, reviewed
schema reconciliation before using this chain. The revision number alone is
insufficient: feature `0026` has operational columns but can lack the segment
identities and model registry that main `0026` represents. `env.py` rejects that
ambiguous state before any migration runs.

For that database, first take and verify a backup. In an isolated restored copy,
compare the actual columns, constraints and indexes with main through `0027`,
apply only missing schema changes (including `fire_dispatch_type` if necessary),
and validate that existing incident, event, dispatch and telemetry data remains
intact. Only after that equivalence is verified can its revision be restamped to
`0027` and upgraded to `0028`. Repeat the validated procedure on the intended
database. Do not blindly stamp `0027`, replay operational column additions, or
downgrade the old operational schema: those operations can skip required schema
or remove recorded history.

Resolving the source merge does not perform this database conversion.
