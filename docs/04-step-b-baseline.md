# Fable — Step B Baseline

**Дата:** 2026-10-27  
**Статус:** BASELINE / IMPLEMENTATION-READY FOR FIRST SLICE  
**Scope:** Quarantine Gates vertical slice; 2–4 players + one GM; TV, Player, GM projections.

Этот документ сводит constitution, glossary, confirmed rules, system contracts, visibility matrix, vertical slice, API/database contracts и шесть Step B reviews. Он принимает технические решения о wire contracts и не меняет подтверждённые gameplay semantics.

## 1. Baseline principles

1. Simulation server — единственный источник истины. Client command — намерение; только server создаёт domain event.
2. Authoritative runtime state, content/template state и transport projections — разные типы. Generic JSONB допускается только как versioned persistence snapshot, не как wire DTO.
3. Все мутации атомарны: state mutation, journal append, idempotency result и revision update коммитятся одной транзакцией до broadcast.
4. Фильтрация visibility выполняется backend до сериализации. Поля не маскируются `null` и не скрываются UI.
5. Gameplay semantics сохраняются: 20 Hz, 250 ms input window, players → enemies → environment, 9×9 slice, карты/режимы/статусы/отступление/rollback согласно CONFIRMED rules.

## 2. Decisions и wire-level consequences

### B-001 — actorId semantics

`actorId` — authenticated session actor (user/device principal), не hero/entity ID и не свободная строка, которой клиент доказывает ownership. Для player command сервер по `(sessionId, actorId, membership)` разрешает ровно один owned `heroId`; GM actor разрешает только sole-GM membership. Команды не принимают `heroId` для выбора чужого героя. Server-generated event `actorId` может содержать authenticated actor, а для domain causality отдельные payload-поля содержат `heroId`/`entityId`.

**Wire consequence:** envelope сохраняет `actorId: string`; `role` и actor membership проверяются сервером и не считаются доверенными. Player payload не получает `heroId` как authority input. Ownership mismatch даёт `AUTH_FORBIDDEN` без раскрытия membership.

Rule IDs: `PARTY-001`, `PARTY-002`, `PARTY-003`, `TIME-001`, `GM-001`.

### B-002 — sceneRevision и clientRevision

`sceneRevision` — authoritative revision сцены. `clientRevision` — копия последней известной `sceneRevision`, присланная client для optimistic concurrency. Для каждой state-changing command требуется точное равенство `clientRevision === current sceneRevision` на момент принятия в scheduler. Stale command не становится бесплатным действием. Одна atomic command/batch увеличивает revision ровно один раз; все события этой группы получают одну post-commit `sceneRevision`, а порядок внутри группы задаётся `eventIndex`.

`clientCardRevision` остаётся отдельной revision player card projection и не заменяет `clientRevision`.

**Wire consequence:** `clientRevision` обязателен в command envelope; snapshot/event всегда возвращают `sceneRevision`; `CommandResult` возвращает актуальную revision. `resumeFromRevision` в join — только cursor для resume и не является альтернативным именем authoritative revision.

Rule IDs: `TIME-005`, `TIME-003`, `TIME-004`.

### B-003 — event scope и sceneId

Journal scope — campaign. `campaignId` обязателен в authoritative event; `sessionId` nullable; `sceneId` nullable. Scene events имеют оба session/scene reference. Campaign/session/checkpoint/rollback/expedition events не получают искусственный `sceneId`. `serverSequence` — global monotonic sequence per campaign; scene-local ordering — query/filter поверх него.

**Wire consequence:** event envelope содержит `campaignId`, `sessionId: string|null`, `sceneId: string|null`, `serverSequence`; DB имеет unique `(campaign_id, server_sequence)`. Transport projection сохраняет scope metadata, но отправляет только разрешённые refs.

Rule IDs: `MAP-001`, `SAVE-001`, `SAVE-002`, `TIME-004`.

### B-004 — canonical event naming

Канонические domain event names — ровно registry ниже, в lower-case dot notation. `mode.changed` — личный режим героя; `scene.pause_changed` — техническое состояние pause; `scene.spawn_accent` — UI-only notification, не journal event. `scene.spawn_applied` не входит в first-slice registry и не принимается как authoritative event. `scene.mode_changed`, если встречается старый transport, нормализуется в `mode.changed` и не пишется в journal.

**Wire consequence:** JSON Schema разрешает только registry names; unknown/alias event rejected or normalized at boundary. Replay хранит только canonical names.

### B-005 — rollback confirmationToken

`gm.rollback_to_checkpoint.payload.confirmationToken` обязателен. Token — opaque, single-use, GM-only, scoped to campaign/session/checkpoint, короткоживущий (10 минут), выдан отдельным GM confirmation endpoint/UI и не хранится в journal payload. Server проверяет token до lock/restore; missing, expired, reused или wrong scope дают `ROLLBACK_CONFIRMATION_REQUIRED`. Rollback полностью восстанавливает checkpoint state, не удаляет историю, создаёт новый `rollback.applied`, увеличивает revision и рассылает fresh filtered snapshot. Player/TV не получают checkpointId, token, source или reason.

**Wire consequence:** command schema requires token; event payload contains only GM/audit checkpoint reference and previous/restored revisions; player-safe notification содержит `{kind:"rollback_notice"}` без id.

Rule IDs: `SAVE-001`, `SAVE-002`.

### B-006 — pause semantics

`gm.pause_scene` — GM-only техническая заморозка active scene. Payload `{paused:boolean}`. При `paused:true` simulation time не advances: `serverTick`, intent timers, stamina regeneration, status expiry, input-window closure and player state-changing commands are frozen/rejected with `STATE_LOCKED`; already committed events remain. GM pause/resume, reconnect, snapshot read и rollback остаются разрешены. Pause не меняет hero mode, HP, deck, outcome или ruleset. При resume scheduler продолжает с того же tick; wall-clock elapsed time не компенсируется. Pause itself is a state mutation and increments `sceneRevision` once.

Canonical event: `scene.pause_changed` payload `{paused:boolean}`. Snapshot contains `scene.timePaused:boolean`. Это технический контракт, не новая gameplay ability.

**Wire consequence:** `gm.pause_scene` активен в command registry; `scene.pause_changed` typed event обязателен; active timer DTO показывает `paused:true` и remaining value без client countdown. Player commands во время pause получают safe `STATE_LOCKED`.

Rule IDs: `TIME-001`, `TIME-002`, `TIME-005`.

### B-007 — timer wire format

Authoritative timer единообразно tick-based при 20 Hz. Timer object:

```json
{
  "startedAtTick": 9000,
  "resolvesAtTick": 9300,
  "durationMs": 15000,
  "remainingMs": 15000,
  "paused": false
}
```

`serverTick` в envelope — текущий authoritative tick. `remainingMs` — server-computed render hint, равный `max(0, (resolvesAtTick-serverTick)*50)` при active scene; client wall clock никогда не участвует в правилах. При pause remainingMs заморожен. `durationMs` и tick fields обязательны для active intent/status/timer projection; clients не присылают timer fields.

**Wire consequence:** intent/status/stamina ring payloads используют the same timer shape; reconnect получает current tick and derived remainingMs; replay использует ticks, не timestamps.

Rule IDs: `TIME-001`, `TIME-002`, `INTENT-003`, `RESOURCE-002`, `RESOURCE-003`, `STATUS-001`.

### B-008 — independent version registry

Версии не смешиваются:

| Axis | First-slice canonical value | Meaning |
|---|---|---|
| `protocolVersion` | `fable.protocol.v1` | transport/envelope and handshake |
| envelope `schemaVersion` | `1` | shape of current command/event envelope |
| `commandVersion` | `1` per command name | payload semantics of one command |
| `eventVersion` | version per canonical event payload | payload semantics of one event; damage uses `hp.changed` v2, while v1 remains replay-only |
| `snapshotSchema` | `fable.snapshot.scene.v1` | filtered scene snapshot shape |
| projection schema | `fable.projection.tv.v1`, `fable.projection.player.v1`, `fable.projection.gm.v1` | role-specific DTO shape |
| `contextVersion` | `fable.context.v1` | AI allow-listed packet shape |
| `rulesetVersion` | `fable.ruleset.0.1` | confirmed gameplay semantics |
| `contentVersion` | `slice.quarantine-gates.v1` | immutable template/content bundle |
| checkpoint `snapshotSchemaVersion` | `1` | persisted authoritative snapshot shape |

**Wire consequence:** commands include `protocolVersion`, `schemaVersion`, `commandVersion`; events include `protocolVersion`, `schemaVersion`, `eventVersion`; snapshots include `protocolVersion`, `snapshotSchema`, projection schema, rulesetVersion and contentVersion. Join negotiates supported versions; no intersection yields `UNSUPPORTED_CONTRACT_VERSION`. A version is never silently reused for new semantics.

Rule IDs: `TIME-001`, `SAVE-001`, `SAVE-002`, `GM-001`.

### B-009 — conditional visibility

`conditional` is a server policy, not a client hint. Internal policy stores a typed `revealPolicy`:

```json
{
  "visibility": "conditional",
  "revealKey": "npc_witness_revealed",
  "revealEventType": "scene.entity_revealed"
}
```

Before the condition, the field/object is omitted entirely from TV/Player/AI output; no null/redacted placeholder is emitted. After the authoritative reveal event, the projection includes the typed public or player-private form. GM receives policy and hidden value. First slice uses this for conditional NPC/target/public HP/status where applicable. Since `scene.entity_revealed` is future/conditional content, it is not added to mandatory first-slice registry unless the slice fixture uses it; policy still governs fields that are conditionally exposed.

**Wire consequence:** projections are structurally different before/after reveal; event registry records `revealPolicy`; negative tests assert absence, not null. Unknown visibility annotation defaults to omission and audit error.

Rule IDs: `PARTY-003`, `MAP-002`, visibility matrix §2–§7.

### B-010 — typed template/runtime split

Content templates are immutable/versioned and carry `key`, content rules and `version/status`; runtime entities carry opaque instance `id`, mutable state and `templateKey` reference. Canonical split:

- `CardTemplate` → `CardInstance` → `DeckState` (four containers of instance IDs).
- `IntentTemplate` → `ActiveIntent` (lifecycle, owner, ticks, target projection).
- `SceneTemplate` → `Scene`/`SceneEntity` runtime.
- `EnemyTemplate` → `EnemyRuntime`.
- `Status` content definition → typed `StatusLayer`.

Templates never contain mutable HP, current position, current timer, ownership or active target. Runtime never copies arbitrary template object into wire DTO.

**Wire consequence:** runtime DTO uses `templateKey`/`instanceId`, not names as identity; persistence JSONB validates against versioned runtime schemas; template changes require contentVersion, not mutation of live instances.

Rule IDs: `DECK-001`—`DECK-006`, `INTENT-001`—`INTENT-005`, `STATUS-001`.

### B-011 — typed payload unions

`CommandEnvelope.payload` and `EventEnvelope.payload` are discriminated unions. JSON Schema uses `oneOf`/`$defs`, discriminator const on `command` or `eventType`, and `additionalProperties:false` at envelope and each payload. Domain validation follows schema: conditional target requirements are checked from CardTemplate; schema allows optional `targetEntityId`/`targetCell` but rejects client result fields (`rawDamage`, `finalDamage`, `hit`, `seed`, `destination`).

**Wire consequence:** unknown command/event names, extra fields, wrong payload shape and client-supplied outcomes fail before scheduler; rejected schema input does not alter gameplay state, `sceneRevision` or journal. The independent authoritative tick loop may still advance.

## 3. Canonical registries

### 3.1 Command registry

| Command | Role | Payload | Authoritative result |
|---|---|---|---|
| `player.move` | player | `{direction}` | `scene.entity_moved` |
| `player.play_card` | player | `{cardInstanceId, targetEntityId?, targetCell?, mode, clientCardRevision}` | card/stamina/hp/status/mode events |
| `player.enter_movement_mode` | player | `{}` | `mode.changed`; retreat follow-ups if melee |
| `player.enter_ranged_mode` | player | `{}` | `mode.changed` |
| `gm.send_hint` | gm | `{targetPlayerId,text,vibration}` | private `hint.sent` |
| `gm.apply_consequence` | gm | `{proposalId,editedPayload,reason}` | validated consequence/journal events |
| `gm.end_expedition` | gm | `{outcome,consequenceId?,createCitySave,reason}` | `expedition.ended` and optional checkpoint |
| `gm.create_checkpoint` | gm | `{label,reason}` | `checkpoint.created` |
| `gm.rollback_to_checkpoint` | gm | `{checkpointId,confirmationToken,reason}` | `rollback.applied` + snapshot |
| `gm.pause_scene` | gm | `{paused}` | `scene.pause_changed` |

### 3.2 Event registry

Canonical first-slice journal events:

`scene.created`, `scene.entity_moved`, `scene.entity_removed`, `card.drawn`, `card.played`, `card.discarded`, `stamina.changed`, `hp.changed`, `status.applied`, `status.refreshed`, `status.expired`, `mode.changed`, `intent.started`, `intent.cancelled`, `intent.resolved`, `intent.target_selected`, `hint.sent`, `scene.ended`, `expedition.ended`, `checkpoint.created`, `checkpoint.restored` (audit/internal alias only), `rollback.applied`, `scene.transferred`, `scene.pause_changed`.

Step C Increment 4 defines `hp.changed` v2 for new damage events and keeps v1 readable by replay. `scene.entity_removed` v1 records enemy cleanup and cell release; `intent.cancelled` reason `owner_removed` precedes removal when applicable. See [DR-C-004](./18-step-c-hp-damage-resolution.md).

`command.accepted` и `command.rejected` — transport results, not domain events. `scene.spawn_accent` — UI-only derived notification. `scene.spawn_applied` — excluded until future scope decision.

Every event registry row defines payload schema, eventVersion, scope, causality (`causedByRequestId` required for command-caused events, nullable for scheduler events), seed policy (GM/audit only), allowed recipients and reveal policy.

### 3.3 Visibility registry

- `tv`: public cells/obstacles/positions, scenario-permitted HP/status subset, public intent icon/timer; target cell/area only when separately approved by visibility/reveal policy; public outcomes.
- `player`: TV-safe data plus own HP/stamina/mode/status layers, own hand/defense slot, available targets, movement directions, addressed hints.
- `gm`: full authorized typed projection: exact intents/targets, decks, formulas, seeds, hidden lore, audit and proposals; never raw credentials/internal transport secrets.
- `ai_context`: explicit allow-list only; never generic GM projection.

`seed`, exact target identity, fallback reason, hidden formula, audit reason, checkpoint id/reason and foreign cards are omitted from TV/Player/AI. `hint.sent` is delivered only to target player and GM; other clients receive no placeholder.

## 4. Canonical JSON shapes

### 4.1 Command envelope

```json
{
  "protocolVersion": "fable.protocol.v1",
  "schemaVersion": 1,
  "commandVersion": 1,
  "requestId": "req_card_01",
  "sessionId": "sess_01",
  "actorId": "user_player_02",
  "role": "player",
  "command": "player.play_card",
  "payload": {
    "cardInstanceId": "ci_123",
    "targetEntityId": "enemy_02",
    "targetCell": {"x":7,"y":3},
    "mode": "ranged",
    "clientCardRevision": 4
  },
  "clientRevision": 41,
  "clientSentAt": "2026-10-27T03:00:00Z"
}
```

`serverReceiveSequence`, `serverReceivedAt`, authorization result, final positions, damage, seed and acceptedAt are server-only.

### 4.2 Event envelope

```json
{
  "protocolVersion": "fable.protocol.v1",
  "schemaVersion": 1,
  "eventId": "evt_1001",
  "eventVersion": 1,
  "campaignId": "camp_01",
  "sessionId": "exp_01",
  "sceneId": "scene_01",
  "sceneRevision": 42,
  "serverTick": 9000,
  "serverSequence": 1001,
  "eventGroupId": "grp_42",
  "eventIndex": 0,
  "causedByRequestId": null,
  "actorId": "enemy_03",
  "replay": {"seedRef":"c74a7436c31ba77a0e781773bd2ec9352fb0397eec4ccbe86bbf2ef3d39e1692"},
  "eventType": "intent.started",
  "payload": {
    "enemyId": "enemy_03",
    "templateKey": "ranged_shot",
    "activeIntentId": "scene_01:enemy_03:9000:ranged_shot",
    "timer": {"startedAtTick":9000,"resolvesAtTick":9200,"durationMs":10000,"remainingMs":10000,"paused":false},
    "icon": "ranged_attack",
    "publicTargetCell": {"x":1,"y":7}
  }
}
```
The example assumes the visibility/reveal policy explicitly approved this public telegraph target cell; otherwise omit `publicTargetCell`. `intent.target_selected` is a separate GM/audit event. The authoritative in-memory journal carries versioned RNG audit sidecar records in addition to the wire envelope; role-filtered output removes forbidden fields before serialization.

### 4.3 Snapshot/projection envelope

```json
{
  "protocolVersion": "fable.protocol.v1",
  "snapshotSchema": "fable.snapshot.scene.v1",
  "projectionSchema": "fable.projection.player.v1",
  "projectionRole": "player",
  "projectionSubject": "player_02",
  "campaignId": "camp_01",
  "sessionId": "sess_01",
  "sceneId": "scene_01",
  "sceneRevision": 42,
  "serverTick": 9000,
  "rulesetVersion": "fable.ruleset.0.1",
  "contentVersion": "slice.quarantine-gates.v1",
  "timePaused": false,
  "state": {}
}
```

Before battle, `hand` and `defenseSlot` are absent, not null. In battle they are typed own-player fields. This is fixed wire semantics.

### 4.4 Runtime entity examples

```json
{
  "id":"enemy_03",
  "kind":"enemy",
  "templateKey":"quarantine_silencer",
  "position":{"x":7,"y":3},
  "hp":350,
  "maxHp":350,
  "defense":15,
  "statusLayers":[],
  "activeIntent":{
    "intentId":"intent_01",
    "templateKey":"bind",
    "ownerEntityId":"enemy_03",
    "state":"telegraphed",
    "timer":{"startedAtTick":9000,"resolvesAtTick":9240,"durationMs":12000,"remainingMs":12000,"paused":false}
  }
}
```

### 4.5 Typed unions

`CardTemplate`, `CardInstance`, `DeckState`, `IntentTemplate`, `ActiveIntent`, `StatusLayer`, `TVSceneProjection`, `PlayerSceneProjection`, `GMSceneProjection` each have a discriminant (`kind`, `projection`, or command/event name). `targetEntityId` and `targetCell` are an input union at domain level; the client can select either/both only when the loaded template requires it. Result values are server-produced event payloads.

## 5. Resolved questions

1. actorId is authenticated user/device actor; hero ownership is server-derived.
2. clientRevision is client copy of sceneRevision; strict equality is required for mutating commands.
3. sceneRevision increments once per atomic command/batch; eventIndex/serverSequence provide event order.
4. event journal is campaign-scoped; sceneId is nullable and never fabricated.
5. canonical personal mode event is `mode.changed`; pause event is `scene.pause_changed`.
6. rollback requires single-use scoped 10-minute confirmationToken in command payload.
7. pause freezes simulation tick/timers/input processing; GM read/control remains available.
8. timer wire is tick-authoritative with `startedAtTick`, `resolvesAtTick`, `durationMs`, derived `remainingMs`, `paused`.
9. protocol/schema/command/event/ruleset/content/snapshot/projection/context versions are independent and pinned.
10. conditional visibility omits unrevealed fields and reveals typed fields only after server reveal policy/event.
11. templates and runtime entities are separate; `templateKey`/`instanceId` are references, not copied mutable definitions.
12. command/event payloads are discriminated typed unions with closed objects.
13. `Session` is persistence/API alias for domain `Expedition`; first-slice gameplay outcomes remain `success|retreat|defeat|gm_abort`.
14. `technical_recovery` is not a player-facing gameplay outcome; if retained in DB it is an audit/lifecycle recovery marker only.
15. pre-battle player cards use field omission, not `null`.
16. `scene.spawn_accent` is UI-only and `scene.spawn_applied` is future scope, not authoritative first-slice events.

## 6. Rule ID additions

Existing Rule IDs remain normative. The following technical IDs are added by this baseline and should be copied into confirmed/system contracts:

- `CONTRACT-001` actor identity and server-derived ownership.
- `CONTRACT-002` strict scene revision and atomic increment.
- `CONTRACT-003` campaign event scope/global sequence.
- `CONTRACT-004` canonical event registry and aliases.
- `CONTRACT-005` rollback confirmation token.
- `CONTRACT-006` pause freeze semantics.
- `CONTRACT-007` tick-authoritative timer wire.
- `CONTRACT-008` independent version axes and negotiation.
- `CONTRACT-009` conditional omission/reveal policy.
- `CONTRACT-010` template/runtime separation.
- `CONTRACT-011` discriminated closed payload unions.

## 7. Migration notes

1. Transport remains `/api/v1`; add protocol negotiation rather than changing the HTTP major line.
2. Add command metadata/version fields and event scope/group/replay fields. Existing events without `campaignId` are migrated by session→campaign lookup; events that cannot be mapped are quarantined, never guessed.
3. Convert old `scene.mode_changed` to canonical `mode.changed` in a deterministic read adapter; do not rewrite append-only journal.
4. Make `scene_id` nullable in event storage and add `campaign_id`; add unique `(campaign_id, server_sequence)` and eventId uniqueness.
5. Backfill `event_version=1`, `schema_version=1`, `ruleset_version=fable.ruleset.0.1` only for records whose existing semantics are verified; otherwise quarantine.
6. Add `snapshot_schema_version`, `content_version`, `projection_schema` and pinned ruleset/content metadata to checkpoints/snapshots.
7. Add rollback token issuance/consumption store with TTL and single-use constraint; never persist raw token in event payload.
8. Convert timer DTO consumers from wall-clock-only behavior to tick + derived remainingMs; client countdown is presentation only.
9. Split intent/card JSONB into typed versioned template/runtime validators; preserve arbitrary effect blobs only behind a versioned content blob boundary until future DSL scope.
10. Add projection fixtures for TV/player/GM/AI and negative tests asserting omission of seed/exact targets/foreign cards/rollback IDs.

## 8. Schema update plan

1. `packages/contracts/common.schema.json`: IDs, keys, Cell, revisions, Timer, versions, visibility/reveal policy.
2. `command.schema.json`: protocol/schema/command versions; command `oneOf`; closed payload definitions for all registry commands; rollback token required; pause payload `{paused}`.
3. `event.schema.json`: campaign/session nullable scene scope; global sequence/group/replay metadata; canonical event `oneOf`; closed typed payloads; seed restricted to authoritative/GM schema.
4. Add `projection.schema.json` (or separate tv/player/gm schemas) with role/subject discriminants and no hidden placeholders.
5. Add `snapshot.schema.json` with snapshot/projection/ruleset/content versions, sceneRevision, serverTick, timePaused.
6. Split `intent-template.schema.json` and `active-intent.schema.json`; update card/template/runtime schemas and typed StatusLayer.
7. `visibility.schema.json`: add revealPolicy and registry references; unknown fields default to omission.
8. Generate TypeScript discriminated unions from schemas and reject unknown fields at runtime.
9. Update Drizzle mappings: nullable scene_id, campaign event scope, event group/index, versions, global sequence uniqueness, checkpoint snapshot/content versions, token store.
10. Add contract fixtures and golden tests for every valid command/event, stale/duplicate/schema errors, pause, rollback, timer, replay and all four projection roles.

## 9. Implementation order

1. Freeze registries, Rule IDs and version constants; add common types and schema validator.
2. Implement authenticated actor/membership/hero ownership resolver and command authorization.
3. Implement typed runtime state (Scene, SceneEntity, HeroRuntime, EnemyRuntime, Card/Deck, StatusLayer, ActiveIntent) and template references.
4. Implement command envelope, idempotency, strict revision check and 250 ms deterministic scheduler.
5. Implement event journal transaction with campaign sequence, group/index, canonical event names and replay metadata.
6. Implement tick/timer service and pause freeze/resume behavior.
7. Implement typed domain events and projection service for TV, Player and GM; add conditional reveal omission rules.
8. Implement checkpoint, city-save, rollback token issuance/consumption, full restore and filtered reconnect snapshot.
9. Implement API/WebSocket capability negotiation and safe errors.
10. Update database migrations and persistence validators; retain append-only history.
11. Create valid/invalid fixtures and golden contract/replay/visibility tests.
12. Run headless 9×9 vertical slice acceptance: movement, intent, cards, stamina, status, retreat/defeat/success, checkpoint and rollback; then integrate clients.

## 10. Remaining questions (future scope only)

1. **RESOLVED for Step C intents (DR-C-002):** use versioned xoshiro128** (`fable.rng.v1`), UTF-8 canonical fork serialization, SHA-256 purpose-scoped seeds, and event-local RNG audit sidecars. This does not require a mutable global RNG stream.
2. **PARTIALLY RESOLVED (DR-C-002):** intent `conditions`, `targetRules`, and `effect` are typed in `intent.schema.json`; broader card-effect DSL fields such as `rawEffect` and `statusEffect` remain future scope.
3. **Production scene transfer command:** define a dedicated `gm.scene_transfer` command/event and its cross-node authorization/reward behavior; first slice only records the already-confirmed transfer capability as future/outcome integration, not a new wire command.

Все остальные вопросы из шести reviews закрыты решениями выше или исключены из first-slice scope. Ни один из них не меняет подтверждённые gameplay semantics.
