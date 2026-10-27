# @fable/content

Versioned, typed, non-executable content for the Step C headless engine. Enemy and intent templates in this package are checked against the canonical JSON Schema in `packages/contracts`; the rules engine consumes runtime fixture selections and does not import UI, transport, database or AI code.

The catalog contains the three confirmed vertical-slice enemies. The active runtime roster includes `quarantine_chaser`, `slag_shooter`, and the existing `extinguisher` template now that both `bind` and `ally_guard` runtime handlers are implemented. `reposition` remains deferred and is not an active runtime handler or fallback.
