# DR-C-004 — Authoritative HP & Damage Resolution

- **Status:** `CONFIRMED`
- **Decision date:** 2026-10-27
- **Scope:** Step C Increment 4 — unified HP/damage pipeline for active enemy intents and retreat basic attacks
- **Package boundary:** `packages/rules` owns deterministic calculation, HP mutation, cleanup, journal events and replay; `packages/content` supplies immutable enemy and intent damage values.

## Decision

### Canonical damage formula

All current damage sources use the same formula and stage order:

```text
mitigation = 100 / (100 + defense)
mitigatedDamage = ceil(rawDamage * mitigation)
finalDamage = ceil(mitigatedDamage * multiplier)
```

The multiplier is not rounded before multiplication. The formula is identified as `fable.damage.v1`. `defense`, `rawDamage` and `multiplier` must be finite and non-negative.

HP application is clamped to `[0, maximum]`:

```text
hpAfter = max(0, min(maximum, hpBefore - finalDamage))
appliedDamage = hpBefore - hpAfter
```

`finalDamage` is the formula result; `appliedDamage` is the actual HP reduction. `hp.changed` is emitted only when HP changes. The maximum HP is unchanged by damage. When present, `publicAmount` retains its existing meaning and equals `finalDamage`, even when HP clamping makes the actual reduction smaller.

This staged rounding is canonical for this pipeline and supersedes the older one-ceiling expression where a fractional multiplier could produce a different result. With a multiplier of `1`, active enemy intents retain the same result as the earlier implementation. Separate physical/magical defense channels, critical hits, misses, healing, status effects and stuns are not implemented in this increment.

### Supported damage sources

The pipeline is used by:

- enemy intent handlers `melee_strike` and `ranged_shot`, with multiplier `1`;
- retreat basic attacks using `melee_strike`, sorted by ascending `enemyId`, with multiplier `1 / attackOrder` (1-based order).

Future card effects may become another source, but cards, decks and card damage handlers remain out of scope. They must not be represented as active handlers in this increment.

### HP and alive-state lifecycle

Runtime HP remains `{current, max}` and `aliveState` remains the lifecycle discriminator.

- A hero whose HP reaches `0` becomes `critically_injured`; the hero remains in the scene and cannot execute gameplay actions.
- An enemy whose HP reaches `0` immediately ceases to be a valid target and cannot resolve or start an intent. Its occupied cell remains blocked until cleanup.
- During cleanup, an enemy with HP `0` becomes `removed`; its cell is freed. The entity remains as a runtime tombstone for journal replay and state hashing.
- HP never becomes negative. Further retreat attacks still resolve in deterministic order after the hero reaches `0`; unchanged HP does not produce another `hp.changed` event.

### Event contract and ordering

New damage events use `hp.changed` **eventVersion 2**. The event preserves the existing `entityId`, `current`, `maximum`, `kind: "damage"` and optional `publicAmount`, and adds:

- `source`: either `{kind:"enemy_intent", enemyId, activeIntentId, handler}` or `{kind:"retreat_attack", enemyId, attackOrder}`;
- `formulaVersion: "fable.damage.v1"`;
- `rawDamage`, `defense`, `multiplier` и `finalDamage`.

Envelope `actorId` сохраняет существующую семантику и указывает на attacking enemy entity для обоих источников. Поле `source` дополнительно идентифицирует handler/active intent либо retreat attack order.

The existing `hp.changed` eventVersion 1 remains valid for historical replay. New damage mutations emit version 2. The authoritative event/journal is not itself a role projection: formula/source fields must be restricted to GM/audit views and omitted from player/TV projections unless separately permitted.

Add canonical event `scene.entity_removed` v1:

```json
{
  "entityId": "enemy-1",
  "reason": "hp_depleted",
  "cell": { "x": 4, "y": 3 }
}
```

The event is required because `hp.changed` alone does not record the cleanup boundary or release of the occupied cell. If the zero-HP enemy owns an active intent, cleanup emits `intent.cancelled` with reason `owner_removed` before removal.

Required order for a zero-HP enemy with an active intent:

```text
hp.changed v2
→ intent.cancelled(reason: owner_removed)
→ scene.entity_removed(reason: hp_depleted)
```

For an enemy intent attack, the established intent order remains `intent.resolved` → `hp.changed`. Retreat emits the actual `hp.changed` events in ascending attacker order, then `mode.changed` with reason `retreat`. Cleanup removal events follow the damage event(s) and cancellation above. All events produced by one damage batch share one `sceneRevision` and one `eventGroupId`.

### Replay

Replay accepts historical `hp.changed` v1 and new v2. For v2 it validates `formulaVersion`, source shape, target defense, formula result and resulting HP against the prior state. It applies the recorded HP result; it does not rerun RNG or infer damage from content. `intent.cancelled(owner_removed)` retires the active intent. `scene.entity_removed` validates zero HP and cell occupancy, marks the enemy `removed`, and frees the cell.

The acceptance criterion is exact equality between live and replay snapshots and `stateHash`, including hero `critically_injured`, enemy tombstones, occupancy, active intents, event ordering, event group and revision.

## Verification

Tests cover formula boundaries and staged rounding; active melee/ranged intents; retreat ordering and coefficients; HP clamping and zero-HP lifecycle; immediate exclusion of pending-removal enemies; cancellation/removal event ordering; event schema v2 plus removal schema; historical v1 replay; and exact live/replay stateHash parity. No card, deck, status, stun, crit or miss behavior is added.
