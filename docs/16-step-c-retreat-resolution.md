# DR-C-003 — Deterministic Retreat Resolution
- **Status:** `CONFIRMED`
- **Decision date:** 2026-10-27
- **Scope:** Step C Increment 3 — retreat attacks, contact transitions, and replay semantics

## Decision

### Retreat attacks
An accepted transition from melee to movement performs one immediate basic attack from each eligible enemy in melee contact. These are not timed intents. Sort attackers by ascending `enemyId`; do not use RNG. For the 1-based attack order `i`, retreat coefficient is `1/i`. It applies only to retreat attacks.

For each attack: `mitigation = 100/(100+heroDefense)`; `mitigatedDamage = ceil(rawDamage*mitigation)`; `finalDamage = ceil(mitigatedDamage*coefficient)`. HP floors at 0. There are no crits, misses, statuses, or stuns. Resolve all eligible attacks even if hero HP reaches 0, and set `critically_injured`. Emit `hp.changed` only when HP actually changes.

Increment 4 routes this calculation through the shared `fable.damage.v1` pipeline. New damage events use `hp.changed` v2; retreat event order remains ordered `hp.changed` events followed by `mode.changed`. See [DR-C-004](./18-step-c-hp-damage-resolution.md).

The enemy templates carry immediate basic attack data, not timed intents:

| Template | `basicAttack` |
|---|---|
| `quarantine_chaser` | `{handler: 'melee_strike', rawDamage: 140}` |
| `slag_shooter` | `{handler: 'melee_strike', rawDamage: 100}` |
| `extinguisher` | `{handler: 'melee_strike', rawDamage: 100}` |

### Mode and contact behavior
Ranged mode is available only when authoritative `hero.canEnterRangedMode === true`; this field participates in runtime state, snapshots, state hash, and replay. Check contact after hero movement, enemy movement, scene activation if available, and mode transition. Ranged-to-movement while in contact and without immunity immediately transitions to melee; it does not run retreat resolution. Retreat resolution occurs only for melee-to-movement.

Retreat sets `contactImmunityUntilTick = currentTick + 300`; immunity is active while `serverTick < contactImmunityUntilTick`. Same-tick enemy intents continue normally under their ordinary preconditions; they are not cancelled or restarted.

### Event group and replay
An accepted retreat command creates one event group and increments `sceneRevision` once. Process attack resolutions and their HP events in ascending `enemyId` order. Update contact immunity before emitting `mode.changed` with reason `retreat`. If HP does not change, do not emit `hp.changed`. Replay reconstructs mode, HP, immunity, event group, and hash from events or deterministic tick. Do not add status events or schemas.

### RNG scope
The canonical RNG algorithm name is `xoshiro128**`; `algorithmVersion` is `fable.rng.v1`; `xoshiro128ss` is internal shorthand only. `retreat_attack_order` is deferred future scope: this increment uses stable `enemyId` ordering and consumes no RNG.
