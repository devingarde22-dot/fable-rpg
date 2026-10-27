# @fable/content

Versioned, typed, non-executable content for the Step C headless engine. Enemy and intent templates in this package are checked against the canonical JSON Schema in `packages/contracts`; the rules engine consumes runtime fixture selections and does not import UI, transport, database or AI code.

The catalog contains the three confirmed vertical-slice enemies. The active runtime fixture intentionally includes only `quarantine_chaser` and `slag_shooter`; `extinguisher` remains catalog-only until `bind` and `ally_guard` runtime handlers are implemented. `reposition` is deferred and is not a registered intent or fallback.
