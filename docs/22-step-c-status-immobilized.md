# Increment 8 — Status Layers & Immobilized (DR-C-008)

**Decision:** DR-C-008 — confirmed implementation scope.
**Implementation branch:** `step-c-increment-8-immobilized`, based on Increment 7 branch `step-c-increment-7-deck-cycle`.
**Status:** implemented and verified; commit `24ca60e` is published in [PR #6](https://github.com/devingarde22-dot/fable-rpg/pull/6) to `main`.
**Scope:** one effect only — enemy `bind` applies `immobilized` to its valid target. Only `TEST_ONLY / NON_BALANCE` intent/enemy fixtures are added.

## 1. Decision

`immobilized` lasts 300 authoritative ticks (15 seconds at 20 Hz), measured from the most recent successful application. Its refresh policy is `refresh_duration`: another successful bind renews the deadline to `applicationTick + 300`; it does not add 300 ticks to the old deadline, increase stacks or potency, or create a second active immobilized layer.

A refresh preserves the existing `layerId`, original `sourceEntityId`, potency, stack count and policy. It updates `appliedAtTick` and `expiresAtTick`. The refresh event identifies the new applying enemy through the event envelope's `actorId`.

A bound hero cannot execute `player.move`; this status does not block card play, mode changes, stamina regeneration, card rotation, or other unimplemented actions. No card effect, status catalog, production enemy balance, or other status behavior is added.

## 2. Typed runtime model

`packages/rules/src/engine/types.ts` defines the narrow key union, the general refresh-policy union and the implemented status layer:

```ts
export type StatusTemplateKey = "immobilized";
export type StatusRefreshPolicy =
  | "refresh_duration"
  | "add_duration"
  | "diminishing_potency"
  | "replace";

export type StatusLayer = {
  id: string;
  templateKey: StatusTemplateKey;
  sourceEntityId: EntityId | null;
  potency: number;
  stacks: number;
  appliedAtTick: number;
  expiresAtTick: number;
  refreshPolicy: StatusRefreshPolicy;
};
```

Increment 8 accepts only `templateKey: "immobilized"`, `refreshPolicy: "refresh_duration"`, and `stacks: 1`; the wider policy union records the Core Engine contract but does not activate the other policies. `IMMOBILIZED_DURATION_MS = 15_000` and `IMMOBILIZED_DURATION_TICKS = 300` are shared constants. `statuses` on both hero and enemy runtime entities is `StatusLayer[]`.

### `createRuntimeState.ts` behavior

- Initial layers are copied into new objects for both heroes and enemies; invalid layers are rejected rather than retained as arbitrary strings.
- Local validation checks a non-empty unique `id` per entity, supported template key/policy, positive finite potency, exactly one stack, non-negative integer `appliedAtTick`, and integer `expiresAtTick > appliedAtTick`.
- After all entities are registered, runtime invariants verify that non-null `sourceEntityId` references an entity in the scene and that the layer has not passed its expiry tick.
- `cloneRuntimeState` and `snapshotState` deep-copy the layer objects so snapshots, test fixtures and mutations do not share layer references.
- No runtime status-template configuration or production catalog is introduced; the current supported status key is intentionally closed to `immobilized`.

## 3. Tick and refresh semantics

The status cleanup phase follows `players → enemies → environment → resources → cards`. A layer remains effective through the gameplay phases at its due tick. At the end of that tick, cleanup emits `status.expired` and removes it. Consequently, a movement command resolved on the due tick is still rejected; a command resolved after that tick's cleanup can move. This boundary is exercised explicitly by integration tests.

A bind resolving while a matching layer exists (including the layer's due tick before cleanup) emits `status.refreshed`, preserves the layer identity, and sets a new full 300-tick deadline. The later cleanup phase sees the refreshed deadline and does not emit an expiration for the old one. A first application emits `status.applied`.

Due expirations are ordered by `entityId`, then `layerId`. Each layer expires once. A missed expiry deadline is an engine error rather than an implicit late cleanup.

## 4. Events and replay

Successful bind transaction order:

```text
intent.resolved
→ status.applied | status.refreshed
→ next intent event, if any
```

`status.applied` and `status.refreshed` carry `entityId`, `statusKey`, `layerId`, and a full timer (`startedAtTick`, `resolvesAtTick`, 15,000 ms duration and remaining time, `paused: false`). The applying enemy is the envelope `actorId`. `status.expired` carries `entityId`, `statusKey` and `layerId` and is not command-caused.

Replay requires the bind status event to immediately follow its matching `intent.resolved` in the same event group, revision and tick. It verifies the actor, target, canonical new layer ID or existing refreshed ID, fixed timer, refresh behavior and deterministic expiration order; missing or altered status transactions are rejected. `stateHash` includes all layer fields and canonicalizes layers by ID.

The event schema accepts only `immobilized` for these Increment 8 status event variants and fixes applied/refreshed duration and remaining time at 15,000 ms. `command.schema.json` is unchanged.

## 5. Test specification

| Area | Scenario | Required assertions |
|---|---|---|
| Runtime-copy unit | Initialize and clone an entity containing a typed layer | Source fixture, runtime, and clone do not share mutable layer objects; layer fields survive intact. |
| Runtime-validation unit | Duplicate ID, unknown key, wrong policy, invalid stacks/potency/ticks or missing source | `createRuntimeState` / invariants reject invalid input. |
| Apply unit | First bind application | One layer, deterministic ID, source, potency 1, stack 1, `refresh_duration`, and exact `T → T+300` timer. |
| Refresh unit | Reapply before expiry and on the due tick | `status.refreshed`; same layer ID/source/potency/stacks; `appliedAtTick` is refreshed; expiry is exactly new tick + 300, not old expiry + 300; no duplicate layer. |
| Expiry unit | Evaluate immediately before and on expiry; process due cleanup twice | No expiry before due; one deterministic `status.expired` at due; removed once; no duplicate event on a second cleanup call. Multiple due layers sort by entity ID then layer ID. |
| Movement integration | Move before and on due tick, then after cleanup | Before and on the expiry tick return `ENTITY_UNABLE_TO_ACT` with no movement or command-caused gameplay mutation; the next eligible window after cleanup accepts movement. |
| Refresh integration | Enemy reapplies bind exactly as old deadline becomes due | `status.refreshed` preserves the layer ID, sets deadline to refreshed tick + 300, and prevents an obsolete `status.expired`. |
| Replay integration | Replay applied, refreshed and expired events and journal tick records | Live snapshot, event replay, journal replay and `stateHash` match exactly. Altering a timer or omitting a bind status event is rejected. |
| Schema integration | Validate each emitted status event; mutate duration/payload | Valid applied/refreshed/expired events pass Ajv; invalid duration, unsupported status key or malformed payload fails schema validation. |

All bind templates and enemies for these tests are marked `TEST_ONLY / NON_BALANCE`; production catalog content remains unchanged.

## 6. Implementation files

- `packages/rules/src/engine/types.ts` — typed status layer, duration constants and event variants.
- `packages/rules/src/engine/createRuntimeState.ts` — initial-layer copying/validation and deep cloning.
- `packages/rules/src/engine/invariants.ts` — source/timer/layer invariants.
- `packages/rules/src/statuses/statusSystem.ts` — active lookup, apply/refresh and due expiration.
- `packages/rules/src/intents/{registry,validation,targeting,intentSystem}.ts` — enable the test-backed bind handler and apply the status on resolution.
- `packages/rules/src/engine/SimulationEngine.ts` and `scheduler/orderCommands.ts` — movement lock and status cleanup phase.
- `packages/rules/src/replay/{replay,stateHash}.ts` — validated status reconstruction and canonical hash fields.
- `packages/contracts/event.schema.json` — strict applied/refreshed/expired event variants.
- `packages/rules/tests/status-*` and `scheduler-*` — unit, integration, replay, schema and phase-order coverage.

## 7. Acceptance and exclusions

Definition of Done: only the approved bind/immobilized behavior is implemented; 300-tick lifecycle and refresh semantics are deterministic; event/schema/replay/hash parity is tested; replay rejects impossible movement during immobilization; all existing Increment 1–7 behavior remains green. Final local gates: `pnpm check` (typecheck, lint, 137 tests: 5 content + 132 rules), `pnpm build`, and `git diff --check` pass.

Explicitly excluded: `unconscious`, `last_chance`, `ally_guard`, `stamina_overload`, generic stacking, status card effects, UI, WebSocket, PostgreSQL, AI, production card/enemy catalogs, and unrelated game balance.
