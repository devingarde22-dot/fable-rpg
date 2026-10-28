# Fable — Database Schema

**Версия:** 0.2  
**Статус документа:** FUTURE TARGET DESIGN — NOT THE ACTIVE RUNTIME SCHEMA  
**Предлагаемая relational database:** PostgreSQL (not selected for the active runtime)  
**Предлагаемый ORM:** Drizzle ORM (obsolete `dev/` scaffold only)  
**Current active persistence:** SQLite via Node's built-in `node:sqlite`; see [DR-INFRA-001](./31-database-persistence-decision.md).

> **Important status distinction:** this document preserves the proposed normalized campaign/lore data model. Its PostgreSQL types, Drizzle declarations, normalized tables, and transaction sketches below are not what the current application creates or uses. The active runtime is `packages/vertical-slice/src/sqlitePersistence.ts`. Do not treat this document as an implementation baseline or build PostgreSQL migrations from it without a new decision.

## 0. Active vertical-slice persistence (verified on main `df627f6`)

The current durable adapter is `SqliteSlicePersistence`, implemented with Node's built-in `node:sqlite` `DatabaseSync`. It configures WAL mode and `synchronous = NORMAL`. The constructor defaults to `:memory:`; a persistent file path must be explicitly provided for data to survive process exit.

The current adapter creates these tables:

| Table | Purpose and current shape |
|---|---|
| `sessions` | Resume-session records keyed by `resume_token`; stores campaign/session/identity, role, optional actor, and update time. |
| `snapshots` | One serialized runtime snapshot per `campaign_id`; the serializer preserves `Map` values. |
| `command_requests` | Command receipt/result records; the current SQLite implementation declares `request_id` as the primary key and stores campaign/session/scene/actor metadata, request/result JSON, status, error code, and timestamps. |
| `campaign_events` | Event journal rows with event identity/version, campaign/session/scene, actor/request IDs, scene revision, server tick/sequence, seed reference, payload JSON, raw event JSON, and creation time. |

The adapter includes indexes for campaign/request lookups and event sequence/time. `appendEvents` batches a set of journal inserts in a SQLite transaction. Snapshot saves and command-receipt writes are separate persistence operations; do not infer a single atomic transaction spanning a command, receipt, snapshot, and journal from the existence of the event transaction.

**Known contract-alignment follow-up:** the SQLite schema currently uses `request_id` as a global primary key. Earlier command/idempotency design describes scope by `(session_id, actor_id, request_id)`. Verify the intended cross-session reuse semantics and align the database constraint, adapter behavior, and regression tests before relying on that broader contract.

This SQLite schema supports the current vertical slice. It does not yet implement the full normalized campaign/lore model described in the target-design sections below.

## 1. Правила хранения для будущей PostgreSQL-модели

- В целевой PostgreSQL-модели PostgreSQL будет хранить campaign/lore/content metadata, sessions, events, commands и checkpoints.
- Быстро меняющееся authoritative scene state живёт в simulation room и периодически фиксируется snapshot/checkpoint.
- Event journal append-only.
- JSONB разрешён для versioned state payload, но ключевые связи и idempotency должны быть нормализованы.
- Все content records имеют `version` и `status`.
- Удаление campaign cascades только там, где это безопасно; audit/event history не удаляется обычным GM действием.

## 2. Core tables (proposed target)

### `users`

| Column | Type | Rules |
|---|---|---|
| id | uuid | PK |
| display_name | varchar(120) | required |
| role | enum/string | player/gm/admin; runtime role всё равно проверяется membership |
| created_at | timestamptz | required |
| updated_at | timestamptz | required |

### `campaigns`

| Column | Type | Rules |
|---|---|---|
| id | uuid | PK |
| name | varchar(180) | required |
| gm_user_id | uuid | FK users |
| ruleset_version | varchar(40) | например `fable-0.1` |
| kingdom_key | varchar(80) | `averenne` |
| doomsday_clock | integer | non-negative |
| state | jsonb | campaign flags/resources |
| created_at/updated_at | timestamptz | required |

### `campaign_members`

Composite PK `(campaign_id, user_id)`. Stores membership and joinedAt. Player access is derived from this table, never from a client-supplied role.

### `sessions`

Stores an expedition/session lifecycle:

```text
id, campaign_id, title, status,
started_at, ended_at, terminal_outcome,
created_at, updated_at
```

`terminal_outcome`: success, retreat, defeat, gm_abort, technical_recovery.

## 3. Content and lore

### `factions`

`id, campaign_id, key, name, description, tags, version, status`.

### `regions`

`id, campaign_id, key, name, corruption, state, metadata`.

### `lore_entities`

`id, campaign_id, kind, key, name, description, tags, canon_level, source, visibility, version, status, metadata`.

`visibility` is never only a UI hint; it is used by projection rules.

### `node_templates`

```text
id, campaign_id, key, type,
public_description, gm_description,
visibility_state, entry_conditions jsonb,
exit_conditions jsonb, route_cost jsonb,
reward_template jsonb, consequence_templates jsonb,
repeatable boolean, version, status
```

### `scene_templates`

```text
id, node_template_id, key, scene_type,
grid jsonb, obstacles jsonb, spawn_rules jsonb,
public_layer jsonb, gm_layer jsonb,
required boolean, version, status
```

### `card_templates`

```text
id, campaign_id, key, name, category,
mode, cost, range_min, range_max,
radius, raw_effect jsonb, status_effect jsonb,
requirements jsonb, visibility, version, status
```

### `enemy_templates`

```text
id, campaign_id, key, name, profile_tier,
hp, defense, base_attacks jsonb,
intent_pool jsonb, target_rules jsonb,
resistances jsonb, version, status
```

### `intent_templates`

```text
id, enemy_template_id, key, icon,
duration_ms, conditions jsonb, effect jsonb,
fallback_keys jsonb, visibility, version, status
```

## 4. Runtime state

### `characters`

```text
id, campaign_id, user_id, name,
hp, max_hp, stamina, max_stamina,
stats jsonb, equipment jsonb, cards jsonb,
statuses jsonb, current_mode, created_at, updated_at
```

Cards in JSON are instance references, not the template definition. A future normalized `card_instances` table may be added when inventory editing is implemented.

### `scenes`

```text
id, session_id, node_template_id, key, title,
mode, grid jsonb, time_paused,
scene_revision bigint, server_tick bigint,
public_state jsonb, gm_state jsonb,
started_at, ended_at, created_at, updated_at
```

`gm_state` must never be selected into player/TV DTOs.

### `scene_entities`

```text
id, scene_id, character_id nullable,
template_id nullable, name, side,
x, y, hp, max_hp, statuses jsonb,
intent jsonb nullable, visibility,
active, state, created_at, updated_at
```

Production must add a unique active-cell constraint at the simulation transaction layer; JSON grid alone is insufficient.

### `scene_projections`

Optional cache table for reconnect/debug:

```text
id, scene_id, role, player_id nullable,
scene_revision, payload jsonb, generated_at
```

It is a cache, not source of truth.

## 5. Events, commands and checkpoints (proposed target)

### `campaign_events`

```text
id uuid PK
campaign_id uuid FK
session_id uuid nullable FK
scene_id uuid nullable FK
event_type varchar
event_version integer
actor_user_id uuid nullable FK
request_id varchar nullable
scene_revision bigint
server_tick bigint
server_sequence bigint
seed varchar nullable
payload jsonb
visibility enum
confirmed_by_gm boolean
created_at timestamptz
```

Indexes: `(campaign_id, created_at)`, `(scene_id, server_sequence)`, and a **non-unique** `(campaign_id, request_id)` lookup index when requestId exists. One command may produce several campaign events, so event rows must not use requestId as a unique key. Idempotency is enforced in `command_requests`.

### `command_requests`

```text
id uuid PK
request_id varchar NOT NULL
campaign_id uuid FK
session_id uuid NOT NULL FK
scene_id uuid nullable FK
actor_id varchar NOT NULL
requested_by uuid FK
confirmed_by uuid nullable FK
command varchar
status enum
client_revision bigint
request_json jsonb
result_json jsonb nullable
error_code varchar nullable
created_at, updated_at
```

Unique idempotency key: `(session_id, actor_id, request_id)`, matching B-001 and the authenticated session actor semantics. `requested_by` remains the user/audit foreign key; it is not a substitute for `actor_id` because an actor may represent an authenticated user/device principal. A repeated key returns the stored command result; the same requestId under another actor or session is independent.

### `checkpoints`

```text
id uuid PK
campaign_id uuid FK
session_id uuid nullable FK
scene_id uuid nullable FK
label varchar
reason varchar
snapshot jsonb
last_event_sequence bigint
ruleset_version varchar
seed_state jsonb
created_by uuid FK
created_at timestamptz
```

### `rollback_events`

```text
id, checkpoint_id, campaign_id, requested_by,
reason, previous_revision, restored_revision,
created_at, audit_payload jsonb
```

Rollback restores state but never deletes the audit row.

### `gm_hints`

```text
id, campaign_id, session_id, scene_id,
from_gm_id, target_player_id, text,
vibration boolean, delivered_at, created_at
```

## 6. Proposed target transaction patterns (not active SQLite behavior)

### Apply player command

```text
BEGIN
→ lock scene/campaign revision
→ insert command_requests if requestId unseen
→ validate current state
→ apply simulation result
→ insert campaign_events
→ update scene snapshot/revision
→ commit
→ broadcast filtered events
```

### Apply GM proposal

```text
BEGIN
→ lock proposal/request
→ validate GM membership
→ validate Schema and content refs
→ validate current sceneRevision
→ apply allowed state changes
→ insert event with confirmed_by_gm=true
→ commit
```

### Rollback

```text
BEGIN
→ lock campaign/session
→ load checkpoint snapshot
→ create rollback audit row
→ restore authoritative snapshot
→ increment revision
→ append rollback.applied event
→ commit
→ broadcast fresh filtered snapshot
```

## 7. Drizzle rules for a future target implementation

- Enums for visibility, scene mode, command status, entity side and outcome.
- `jsonb` fields have explicit TypeScript `$type`.
- Every table has `createdAt` and `updatedAt` where mutable.
- Foreign keys use explicit `onDelete` policy.
- Migrations are reviewed; AI cannot apply destructive migration automatically.
- Schema code is generated/edited only from this document and a Decision Record.

## 8. Future-target implementation checklist (not the active SQLite schema)

`dev/database/schema.ts` is part of the obsolete `dev/` scaffold and is not connected to the active runtime. The checklist below applies only if the team later chooses to implement this normalized PostgreSQL/Drizzle target. It is not a list of missing pieces in `SqliteSlicePersistence`, and it must not be read as a commitment to PostgreSQL:

1. `eventVersion`, `sceneRevision`, `serverTick`, `serverSequence`, `seed` to events;
2. unique requestId/idempotency index;
3. checkpoints and rollback_events;
4. node/scene/card/enemy/intent template tables;
5. terminal expedition outcome;
6. content version/status;
7. field-level projection cache or explicit projection service;
8. membership and authorization constraints;
9. migration tests;
10. append-only audit policy.
