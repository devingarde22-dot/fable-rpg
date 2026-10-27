# Fable — Step B Review: Fixtures и contract tests

**Статус отчёта:** PROPOSAL для реализации; CONFIRMED-правила и gameplay semantics не изменяются.  
**Дата:** 2026-10-27  
**Scope:** valid/invalid fixtures, golden tests и acceptance matrix для command/event/intent/visibility contracts первого vertical slice.

## 1. Scope

Этот review рассматривает ровно один предмет: как зафиксировать тестовые данные и проверяемую матрицу контрактов так, чтобы изменения в схемах, API, projections и headless simulation не проходили незамеченными.

В scope входят:

- каноническая структура каталога fixtures;
- valid и invalid fixtures для текущих четырёх JSON Schema;
- fixtures для command payloads, event payloads, intent templates и visibility annotations;
- golden tests для envelope, deterministic replay, role-filtered projections и safe errors;
- acceptance matrix, связывающая тест с API, visibility, vertical slice и Rule ID;
- конкретные несовпадения между текущими schema и уже подтверждёнными контрактами;
- список файлов, которые потребуется изменить при реализации.

Вне scope:

- изменение игрового дизайна, баланса, damage formula, intent DSL или state machine;
- добавление новых команд, событий, карт, врагов, городов или лора;
- реализация production auth, database migration, UI и AI auto-apply;
- утверждение неописанной semantics для `gm.pause_scene`, `technical_recovery`, public HP/status policy или conditional reveal.

Если fixture требует сведения, которого нет в CONFIRMED документах, оно обозначено `OPEN_QUESTION`, а не превращено в молчаливое правило.

## 2. Recommended contract

### 2.1 Принцип fixture-first contract testing

Каждый контракт должен иметь четыре связанных артефакта:

1. **valid fixture** — минимальный и representative пример, который обязан пройти schema validation;
2. **invalid fixture** — ровно одна намеренная ошибка формы на fixture, который обязан быть отклонён до domain mutation;
3. **golden expectation** — стабильный сериализованный результат или normalized error, утверждённый в review;
4. **acceptance row** — связь с Rule ID, endpoint/command/event, visibility role и проверяемым эффектом.

Fixtures не являются второй базой правил. Они используют только значения, уже присутствующие в documents и vertical slice: `scene_01`, карта 9×9, 4 роли/проекции, `fable-0.1`, timers не ниже 3000 ms, 2–4 players и один GM. Tuning numbers из vertical slice (HP, damage, durations) должны быть отделены от contract fixtures и не использоваться как скрытый источник gameplay semantics.

Рекомендуемый pipeline каждого contract test:

```text
load fixture
→ parse JSON
→ validate envelope/schema
→ validate command/event-specific payload
→ normalize nondeterministic fields
→ assert golden / rejection code
→ for accepted command: run headless domain validation
→ assert state/event/projection/visibility invariants
```

Schema rejection не должен запускать scheduler, менять `sceneRevision`, писать event или раскрывать поля из rejected input.

### 2.2 Каталог fixtures

Рекомендуемая структура (имена файлов — proposal для реализации):

```text
packages/contracts/fixtures/
  commands/valid/player.move.json
  commands/valid/player.play_card.json
  commands/valid/player.enter_movement_mode.json
  commands/valid/player.enter_ranged_mode.json
  commands/valid/gm.send_hint.json
  commands/valid/gm.apply_consequence.json
  commands/valid/gm.end_expedition.json
  commands/valid/gm.create_checkpoint.json
  commands/valid/gm.rollback_to_checkpoint.json
  commands/valid/gm.pause_scene.json              # OPEN_QUESTION / disabled
  commands/invalid/*.json
  events/valid/*.json
  events/invalid/*.json
  intents/valid/*.json
  intents/invalid/*.json
  visibility/valid/*.json
  visibility/invalid/*.json
  projections/tv/*.json
  projections/player/*.json
  projections/gm/*.json
  projections/ai/*.json
  golden/schema-errors/*.json
  golden/projections/*.json
  golden/replay/*.json
```

Имена fixture должны быть стабильными и не содержать случайных timestamp. Все deterministic IDs (`req_01`, `scene_01`, `enemy_02`) должны использоваться только в fixture/test scope. Для random outcomes seed хранится в event/golden fixture только там, где уже предусмотрено контрактом; player/TV/AI golden output seed не содержит.

### 2.3 Valid command fixture baseline

Текущая `command.schema.json` валидирует envelope, но не payload-specific shape. До расширения schema valid fixtures всё равно должны быть написаны в целевой форме, чтобы contract test сначала ловил пробел schema, а затем domain validator.

#### `player.move`

```json
{
  "requestId": "req_move_01",
  "sessionId": "sess_01",
  "actorId": "player_01",
  "role": "player",
  "command": "player.move",
  "payload": { "direction": "up" },
  "clientRevision": 41,
  "clientSentAt": "2026-10-27T03:00:00Z"
}
```

Проверяется только намерение направления. `destination`, `hp`, `stamina`, `rawDamage`, `finalDamage` и server sequence отсутствуют. Это сохраняет TIME-001, MOVE-001/002 и server authority.

#### `player.play_card`

```json
{
  "requestId": "req_card_01",
  "sessionId": "sess_01",
  "actorId": "player_02",
  "role": "player",
  "command": "player.play_card",
  "payload": {
    "cardInstanceId": "card-instance-123",
    "targetEntityId": "enemy-02",
    "targetCell": { "x": 7, "y": 3 },
    "mode": "ranged",
    "clientCardRevision": 4
  },
  "clientRevision": 41
}
```

Fixture намеренно не содержит raw/final damage и hit result. Наличие `targetEntityId`/`targetCell` является client selection, а не подтверждением попадания. Для self/AOE/no-target card требуется отдельный valid fixture без target; доменная проверка определяется card template, а не generic JSON Schema.

#### Пустые player-команды

```json
{
  "requestId": "req_mode_01",
  "sessionId": "sess_01",
  "actorId": "player_01",
  "role": "player",
  "command": "player.enter_movement_mode",
  "payload": {},
  "clientRevision": 41
}
```

```json
{
  "requestId": "req_ranged_01",
  "sessionId": "sess_01",
  "actorId": "player_02",
  "role": "player",
  "command": "player.enter_ranged_mode",
  "payload": {},
  "clientRevision": 41
}
```

Клиент не передаёт `force`, destination или attack result.

#### GM fixtures

`gm.send_hint`:

```json
{
  "requestId": "req_hint_01",
  "sessionId": "sess_01",
  "actorId": "gm_01",
  "role": "gm",
  "command": "gm.send_hint",
  "payload": {
    "targetPlayerId": "player_02",
    "text": "Проверь клетку за статуей.",
    "vibration": true
  },
  "clientRevision": 41
}
```

`gm.end_expedition`:

```json
{
  "requestId": "req_end_01",
  "sessionId": "sess_01",
  "actorId": "gm_01",
  "role": "gm",
  "command": "gm.end_expedition",
  "payload": {
    "outcome": "retreat",
    "createCitySave": false,
    "reason": "Партия отступила от карантинных ворот"
  },
  "clientRevision": 52
}
```

`consequenceId` отсутствует в retreat fixture, если state machine не требует consequence. Для success с consequence нужен отдельный fixture. Это не утверждает обязательность/необязательность поля вне уже описанной state machine.

`gm.rollback_to_checkpoint`:

```json
{
  "requestId": "req_rollback_01",
  "sessionId": "sess_01",
  "actorId": "gm_01",
  "role": "gm",
  "command": "gm.rollback_to_checkpoint",
  "payload": {
    "checkpointId": "checkpoint-city-before-quarantine-01",
    "confirmationToken": "confirm-opaque-token",
    "reason": "Возврат после технической ошибки"
  },
  "clientRevision": 61
}
```

`confirmationToken` следует считать обязательным baseline, но это ещё не согласованное изменение текущего `03-system-contracts.md`; см. OPEN_QUESTION OQ-01.

### 2.4 Invalid command fixtures

Invalid fixtures делятся на `schema_invalid` и `domain_invalid`. Первый класс должен быть отклонён JSON Schema до auth/scheduler. Второй проходит форму, но получает безопасный domain error и не мутирует state.

| Fixture | Ошибка | Ожидание |
|---|---|---|
| `missing-request-id.json` | отсутствует required `requestId` | schema reject; no gameplay mutation/domain event |
| `unknown-envelope-field.json` | `serverReceiveSequence` прислан клиентом | schema reject; server sequence не доверяется |
| `bad-role.json` | `role: "tv"` | schema reject |
| `bad-command.json` | неизвестное имя command | schema reject |
| `negative-revision.json` | `clientRevision: -1` | schema reject |
| `bad-client-sent-at.json` | timestamp не date-time | schema reject |
| `move-extra-destination.json` | у `player.move` есть `destination` | payload schema reject |
| `move-diagonal.json` | `direction: "up-left"` | payload schema reject |
| `card-client-damage.json` | `rawDamage`/`finalDamage` во входе | payload schema reject; клиент не задаёт результат |
| `card-bad-mode.json` | mode не в `melee/ranged/movement` | payload schema reject |
| `gm-hint-empty-text.json` | пустой text | payload/domain reject; safe error |
| `player-calls-gm.json` | player envelope с `gm.send_hint` | auth/role reject; no gameplay mutation |
| `rollback-without-confirmation.json` | отсутствует token | schema/domain reject; no rollback |
| `duplicate-request-different-payload.json` | тот же requestId, другой payload | `DUPLICATE_REQUEST`; второй event не создаётся |
| `stale-revision.json` | устаревший `clientRevision` | `STALE_SCENE_REVISION`; gameplay state, `sceneRevision` и journal unchanged; tick/window bookkeeping may advance |
| `zero-stamina-positive-card.json` | shape valid, cost > 0 при stamina 0 | `INSUFFICIENT_STAMINA`; no card.played |
| `blocked-move.json` | shape valid, клетка занята/закрыта | `CELL_BLOCKED`; no move event |
| `hidden-target-card.json` | shape valid, target not visible/allowed | safe `TARGET_NOT_VISIBLE`; hidden reason absent |

`serverReceiveSequence`, `serverReceivedAt`, authorization result, acceptedAt, event IDs и final positions не должны быть входными fixture fields.

### 2.5 Valid event fixtures

Минимальный valid event envelope по текущей schema:

```json
{
  "eventId": "evt_91",
  "eventType": "scene.entity_moved",
  "eventVersion": 1,
  "sceneId": "scene_01",
  "sceneRevision": 42,
  "serverTick": 880,
  "serverSequence": 91,
  "causedByRequestId": "req_move_01",
  "actorId": "player_01",
  "payload": {
    "entityId": "hero_01",
    "fromCell": { "x": 1, "y": 8 },
    "toCell": { "x": 1, "y": 7 },
    "movementKind": "step"
  }
}
```

Для deterministic intent selection:

```json
{
  "eventId": "evt_92",
  "eventType": "intent.target_selected",
  "eventVersion": 1,
  "sceneId": "scene_01",
  "sceneRevision": 43,
  "serverTick": 900,
  "serverSequence": 92,
  "seed": "seed-tie-break-01",
  "payload": {
    "intentId": "intent_01",
    "enemyId": "enemy_03",
    "targetCell": { "x": 1, "y": 7 }
  }
}
```

Seed разрешён только в authoritative/GM/audit fixture. В transport golden для TV/Player/AI seed удаляется, а не заменяется на `null`, если recipient policy запрещает поле.

Для `status.applied` GM fixture допускает полный слой:

```json
{
  "eventId": "evt_93",
  "eventType": "status.applied",
  "eventVersion": 1,
  "sceneId": "scene_01",
  "sceneRevision": 44,
  "serverTick": 930,
  "serverSequence": 93,
  "actorId": "enemy_03",
  "payload": {
    "targetId": "hero_01",
    "status": {
      "statusKey": "immobilized",
      "sourceId": "enemy_03",
      "potency": 1,
      "appliedAtTick": 930,
      "expiresAtTick": 1230,
      "stackIndex": 0,
      "category": "control"
    }
  }
}
```

`rawDamage`, mitigation, exact formula, fallback reason и audit reason не должны попадать в public event fixture. Их место — отдельный GM/audit payload schema, если это будет формализовано.

### 2.6 Invalid event fixtures

| Fixture | Ошибка | Ожидание |
|---|---|---|
| `event-missing-scene-revision.json` | отсутствует required revision | schema reject |
| `event-negative-tick.json` | `serverTick: -1` | schema reject |
| `event-unknown-envelope-field.json` | клиентский/неизвестный field | schema reject |
| `event-bad-version.json` | `eventVersion: 0` | schema reject |
| `event-seed-in-player-projection.json` | seed присутствует в Player output | visibility contract reject/golden mismatch |
| `event-exact-target-on-tv.json` | `targetEntityId` в TV payload | visibility contract reject |
| `event-hidden-reason-on-player.json` | fallback/cancel exact reason игроку | visibility contract reject |
| `event-nonmonotonic-sequence.json` | sequence уменьшается в replay | replay assertion fail |
| `event-duplicate-id.json` | тот же eventId дважды | journal/replay assertion fail |
| `event-payload-extra-final-damage.json` | клиентский результат в payload без policy | typed payload reject |

Текущая `event.schema.json` не может отклонить все эти payload-level случаи, поскольку `payload` — произвольный object. Это gap, а не основание ослаблять fixture.

### 2.7 Intent fixtures

Исторический proposal ниже superseded: текущий pre-release contract зафиксирован в [`packages/contracts/intent.schema.json`](../../packages/contracts/intent.schema.json) и [DR-C-002](../15-step-c-intent-simulation.md). Актуальный typed fixture для `ranged_shot`:

```json
{
  "kind": "intent_template",
  "key": "ranged_shot",
  "version": 1,
  "status": "confirmed",
  "icon": "ranged_attack",
  "durationMs": 10000,
  "conditions": { "preconditions": ["target_available"] },
  "effect": { "handler": "ranged_shot", "parameters": { "rawDamage": 110 } },
  "targetRules": {
    "policy": "highest_threat",
    "fallbackPolicies": ["nearest_visible_player"],
    "range": { "minInclusive": 2, "maxInclusive": 7 },
    "lineOfSight": "required",
    "filters": {
      "factions": ["party"],
      "aliveStates": ["active"],
      "requiredStatuses": [],
      "excludedStatuses": []
    }
  },
  "fallbackKeys": ["hold_position"],
  "visibility": "public"
}
```

Базовые invalid fixtures:

- `durationMs: 2999` or `durationMs: 3025` → schema reject: minimum 3000 ms and multiples of 50;
- `visibility: "player_private"` → schema reject, поскольку intent schema разрешает только public/conditional/gm_only;
- `key: "Ranged Shot"` → schema reject по key pattern;
- отсутствует typed `conditions`, `effect`, `targetRules` or `fallbackKeys` → schema reject;
- an otherwise schema-valid intent with impossible preconditions is rejected at runtime, does not partially mutate gameplay state, and follows its ordered fallback list;
- equal-ranked targets with the same seed produce the same target and exact journal replay result.

`conditions`, `effect` и `targetRules` are typed structures in the confirmed pre-release contract; do not restore the obsolete opaque-object proposal.

### 2.8 Visibility fixtures

Valid annotation examples:

```json
{ "field": "hero.hp", "visibility": "public", "condition": null, "redaction": null, "roles": ["tv", "player", "gm"] }
```

```json
{ "field": "enemy.activeIntent.targetEntityId", "visibility": "gm_only", "condition": null, "redaction": "omit", "roles": ["gm"] }
```

```json
{ "field": "hint.text", "visibility": "conditional", "condition": "recipient.playerId == targetPlayerId", "redaction": "omit", "roles": ["player", "gm"] }
```

Invalid:

- unknown visibility level `private`;
- `roles: ["server"]`;
- empty `field`;
- `condition` не string/null;
- `redaction` не string/null;
- `seed` annotated `public` без explicit Decision Record;
- `gm_only` field с role `tv`/`player` в role-filtered projection;
- private hint присутствует в snapshot другого player хотя бы с redacted text.

Важно: текущая visibility schema валидирует annotation primitive, но не связывает annotation с реальным JSON path DTO. Поэтому visibility fixtures должны запускать второй policy test: собрать TV/Player/GM/AI projection и доказать отсутствие запрещённых paths.

### 2.9 Projection fixture set

Один authoritative scene fixture должен порождать четыре expected outputs, а не четыре вручную расходящихся источника истины:

- **TV:** grid, obstacles, public entity positions, разрешённый public HP, icon/timer/red target cell/area; без hand, stamina, seed, exact target, audit reason, GM lore.
- **Player-01:** TV-safe data плюс hero-01 HP/stamina/mode/full own allowed statuses/hand/defense slot/available targets и только адресованные hints.
- **Player-02:** тот же public слой, но hand/defense/status private fields только hero-02; hint player-01 отсутствует целиком.
- **GM:** full authorized typed projection, включая exact intents/targets, all decks/discards, full status layers, seed, audit и GM lore; это не raw database/server state.
- **AI:** explicit context packet only; no generic GM projection, no credentials, no seed/audit by default.

Ожидаемый negative invariant для всех role outputs: запрещённое поле отсутствует, а не присутствует со значением `null` или маскирующей строкой, если matrix говорит “no”.

## 3. Golden tests

### 3.1 Schema goldens

Набор `schema.contract.test.ts` должен параметризованно прогонять все valid/invalid fixtures по четырём schema и command/event-specific schemas. Минимальные assertions:

- valid fixtures проходят без coercion;
- invalid fixtures дают stable error class/path, но не зависят от текста библиотеки validator;
- `additionalProperties: false` защищает envelope и typed payload;
- nullability проверяется отдельно от omission;
- schema reject не вызывает gameplay-state mutation или domain event.

Golden error хранит нормализованный объект, например:

```json
{
  "kind": "schema_invalid",
  "path": "/payload/direction",
  "keyword": "enum"
}
```

Не следует фиксировать полную vendor-specific строку Ajv/Zod.

### 3.2 Command lifecycle goldens

Для каждого command vertical slice нужен минимум один accepted и один rejected path. Accepted golden проверяет command result, event type(s), causation, post-revision и filtered recipients. Rejected golden проверяет error code, unchanged gameplay state/`sceneRevision`/domain journal и отсутствие domain event. `serverTick` и scheduler bookkeeping могут продвигаться при обработке закрываемого окна.

Обязательные cases:

1. `player.move` в свободную клетку → один `scene.entity_moved`;
2. move через wall/statue/enemy/ally → `CELL_BLOCKED`, gameplay state/`sceneRevision`/journal unchanged (tick bookkeeping may advance);
3. stale move → `STALE_SCENE_REVISION`, no event;
4. same requestId retry → original result, no duplicate events;
5. positive-cost card at stamina 0 → `INSUFFICIENT_STAMINA`;
6. zero-cost card at stamina 0 → accepted if all other conditions pass;
7. ranged card through wall/barrier or out of range → safe error, no damage;
8. non-AOE multi-target card without target → `TARGET_REQUIRED` only if this code is approved; currently OPEN_QUESTION because it is not in error enum;
9. movement from melee → retreat resolution events in enemy order, then movement mode;
10. immobilized hero → no move, status remains until server expiry;
11. `gm.send_hint` → target player + GM only;
12. non-GM calling GM command → `AUTH_FORBIDDEN`;
13. consequence proposal without GM confirmation → no state change;
14. end expedition success/retreat/defeat/gm_abort each follows distinct state transition;
15. rollback with confirmation → restored state + incremented revision + audit only for GM, no duplicate reward;
16. rollback retry or already-applied outcome → safe idempotent result/error per approved command contract.

### 3.3 Deterministic replay goldens

Replay golden input: same initial checkpoint, same ruleset/content fixture, same command order, same seed and same 250 ms batching. Expected output compares normalized event sequence, state hash and role projections. Exclude generated IDs and wall-clock fields from hash, or provide deterministic test IDs.

Минимум:

```text
seed S + equal-priority targets → same targetEntityId in GM state
seed S + same commands → same event type/order/revision/state hash
changed seed S2 → only random-dependent result may differ; hidden seed remains absent from player/TV/AI output
```

Golden must assert players → enemies → environment order, `serverSequence` monotonicity and replay from checkpoint. `serverTick` is not a deduplication key.

### 3.4 Visibility goldens

Для одного authoritative fixture генерируются role goldens и проверяется allow/deny matrix:

| Role | Must contain | Must never contain |
|---|---|---|
| TV | public cells/entities, public telegraph, permitted public HP/status | hand, defense slot, draw pile, exact target, seed, audit reason, GM lore |
| Player-01 | own hero cards/defense/stamina/status, public telegraph, own hint | Player-02 hand/discard, seed, fallback pool, hidden target, GM lore |
| Player-02 | own private fields and only own hint | Player-01 hint/cards, seed, audit, hidden route |
| GM | authorized typed full projection and audit | credentials, transport secrets, undeclared raw DB fields |
| AI | selected context packet only | generic GM projection, cards by default, seed, credentials, audit |

Reconnect golden повторно строит projection из same authoritative state и `sceneRevision`; output не становится более подробным. Rollback notification golden допускает safe notification, но не checkpoint id/reason для players.

### 3.5 Golden stability policy

Golden files обновляются только вместе с одним из следующих изменений:

- согласованное изменение schemaVersion/eventVersion/commandVersion;
- утверждённое изменение visibility policy;
- исправление фактического bug в serializer/domain implementation.

Изменение golden без ссылки на Rule ID, review/Decision Record и acceptance row запрещено. Tuning values не должны заставлять менять contract golden, если форма и visibility не изменились.

## 4. Acceptance matrix

| ID | Contract / scenario | Fixture | Expected check | Rule/API source | Level |
|---|---|---|---|---|---|
| F-01 | command envelope valid | `player.move.json` | schema pass; no client server fields | TIME-001; system §2; command schema | schema |
| F-02 | unknown command field | `unknown-envelope-field.json` | reject, no gameplay mutation/domain event | system §2; API §4 | schema |
| F-03 | direction invalid | `move-diagonal.json` | enum reject | MOVE-001/002 | schema |
| F-04 | blocked movement | `blocked-move.json` | `CELL_BLOCKED`, gameplay state/revision/journal unchanged; tick bookkeeping may advance | MOVE-002, TIME-005 | integration |
| F-05 | stale command | `stale-revision.json` | `STALE_SCENE_REVISION`, no free action | TIME-005 | integration |
| F-06 | idempotent retry | duplicate fixtures | same result, no duplicate event | system §1; API §8 | integration |
| F-07 | play-card input safety | `card-client-damage.json` | reject extra result fields | DECK-006/007; constitution §4.1 | schema |
| F-08 | zero-cost card | `zero-cost-card.json` | accepted at 0 stamina when domain conditions pass | DECK-007; slice §5 | simulation |
| F-09 | positive-cost card | `zero-stamina-positive-card.json` | `INSUFFICIENT_STAMINA` | DECK-007; RESOURCE-002 | simulation |
| F-10 | hand and defense | combat snapshot fixture | 5 ordinary + 1 defense; no loss on filter | DECK-003—006 | projection/simulation |
| F-11 | LoS/range/target | ranged card fixtures | wall/barrier/range decisions match rules | COMBAT-002/003 | simulation |
| F-12 | retreat | melee movement fixture | enemy free attacks then movement mode | MOVE-004/005; COMBAT-006 | simulation |
| F-13 | status layer | immobilize/stack fixtures | 15 sec lock; layer potency not silently summed | STATUS-001—004 | simulation |
| F-14 | intent timer | `ranged_shot`/`bind` | min 3 sec accepted; impossible intent cancels and fallback starts | INTENT-003/005 | simulation |
| F-15 | deterministic target | equal-target seed fixture | same seed gives same target | INTENT-006; TIME-001 | replay |
| F-16 | event envelope | valid event fixtures | required metadata, sequence/revision valid | system §2; event schema | schema |
| F-17 | event typed payload | invalid event payloads | extra/incorrect fields rejected | system §4; API §3 | schema |
| F-18 | TV redaction | TV golden | no exact target/seed/GM data | VIS matrix §3–4; constitution §4.3 | visibility |
| F-19 | player isolation | Player-01/02 goldens | no other hand/discard/private hint | PARTY-003; VIS matrix §6 | visibility |
| F-20 | GM projection | GM golden | full authorized typed state, not raw DB/credentials | PARTY-003; system §7 | visibility |
| F-21 | AI packet | AI golden | allow-listed context only | GM-001/003; API §6 | visibility |
| F-22 | safe errors | stale/hidden target/schema fixtures | no hidden reason, target, seed or input secrets | constitution §4.3; API §5 | security |
| F-23 | reconnect | same revision snapshot | filtered snapshot only, no visibility escalation | system §10; API §8 | e2e |
| F-24 | outcome idempotency | success/retreat/defeat/rollback | reward not duplicated; retreat/defeat lock reward | MAP-003/004; SAVE-001/002 | persistence |
| F-25 | checkpoint replay | city-before-quarantine fixture | restore full authoritative state, retain audit | SAVE-001/002; DB §5/6 | replay/persistence |
| F-26 | 4-player slice | 4 player sessions + GM | reference 3-herо debug remains possible; production acceptance 4 players | PARTY-001; slice §3/DoD | e2e |

### Acceptance levels

- **schema:** pure JSON Schema/typed payload validation;
- **integration:** command pipeline, idempotency, revision and safe error;
- **simulation:** headless state transition and event order;
- **visibility:** per-recipient serialization and negative field assertions;
- **replay:** fixed seed/checkpoint deterministic reconstruction;
- **persistence:** journal/checkpoint/rollback/reward idempotency;
- **e2e:** WebSocket/HTTP path with TV, four players and GM.

Definition of Done для этой темы: все F-01—F-26 имеют fixture, assertion и ссылку на source Rule/API; ни один accepted command не обходится только schema test; ни один visibility case не проверяется только UI snapshot.

## 5. Affected Rule IDs

Основные Rule ID:

- `PARTY-001`—`PARTY-003`: 2–4 players, один GM, role/device projection и 4-player acceptance;
- `TIME-001`—`TIME-005`: server authority, tick/input window/order, stale command;
- `MOVE-001`—`MOVE-005`: coordinate/blocked movement/movement mode/retreat immunity;
- `DECK-001`—`DECK-008`: single deck, hand/defense, containers, filter, stamina, magic/item effects;
- `COMBAT-001`—`COMBAT-006`: melee/range/target/LoS/damage/miss/retreat;
- `RESOURCE-001`—`RESOURCE-003`: HP, stamina and ring timer;
- `STATUS-001`—`STATUS-004`: layers, stacking, heavy injury, immobilization;
- `INTENT-001`—`INTENT-006`: no enemy deck, telegraph, timer, movement, impossible intent and seeded tie-break;
- `MAP-001`—`MAP-004`: node/scene, discovery, retreat/defeat/reward locks;
- `SAVE-001`—`SAVE-002`: city save/checkpoint and complete rollback;
- `GM-001`—`GM-003`: confirmed consequence, private hint, GM-owned dialogue.

`VIS-*` упоминаются в convention, но отдельных `VIS-001` и т.п. в `02-confirmed-rules.md` нет. В этом отчёте visibility acceptance ссылается на `03-system-contracts.md §7`, `04-visibility-matrix.md` и constitutional rule, пока отдельные стабильные `VIS-*` не будут добавлены через нормализацию документов. Это не должно быть исправлено придумыванием новых Rule ID в тестах.

## 6. Conflicts и конкретные решения

### C-01 — Generic payload в command/event schema

**Факт:** `command.schema.json:payload` и `event.schema.json:payload` имеют только `type: object`; unknown payload fields проходят.  
**Решение:** добавить discriminated command/event payload schemas с `additionalProperties: false` и `$defs`; fixtures писать уже в целевой форме. До реализации schema-level invalid tests должны быть помечены expected-fail/gap, а domain tests не должны считать generic schema достаточной защитой.

### C-02 — Event schema допускает seed на любом wire output

**Факт:** `seed` разрешён в общем event envelope, тогда как visibility matrix ограничивает seed GM/audit.  
**Решение:** разделить authoritative/journal fixture и role-filtered transport goldens; проверять отсутствие запрещённого path, а не `null`. При сохранении общего envelope нужен recipient-aware serializer/policy.

### C-03 — Current event schema не допускает non-scene event

**Факт:** `sceneId` required, но `checkpoint.created`, `expedition.ended` и rollback могут быть campaign/session scoped.  
**Решение:** либо сделать `sceneId` nullable в следующей schema version, либо иметь отдельный documented non-scene envelope. Для fixtures выбрать один вариант до реализации; текущий review не молча меняет schema.

### C-04 — `confirmationToken` отсутствует в system-contract command example

**Факт:** API и commands review требуют token, текущий `03-system-contracts.md` пример rollback содержит только checkpointId/reason.  
**Решение:** безопасный test baseline — invalid без token и valid с token, но это `OPEN_QUESTION`, пока owner не подтвердит wire shape.

### C-05 — `gm.pause_scene` есть в command enum/API, но нет confirmed semantics

**Факт:** команда перечислена, однако Rule ID, event name, timer/input-window behavior и reconnect policy не закреплены.  
**Решение:** иметь только schema placeholder fixture с маркировкой `OPEN_QUESTION`; не включать accepted simulation golden и не мутировать state до отдельного решения.

### C-06 — Error code `TARGET_REQUIRED` нужен command review, но отсутствует enum

**Факт:** non-AOE multi-target без target описан как ожидаемый безопасный отказ в commands review, однако `03-system-contracts.md §8` его не перечисляет.  
**Решение:** до добавления error code тестировать только schema/domain invariant “no gameplay mutation/domain event” либо использовать уже подтверждённый эквивалент после ADR. Нельзя добавлять новый public error code молча.

### C-07 — Visibility schema не связывает annotation с DTO

**Факт:** `visibility.schema.json` валидирует annotation object, но не проверяет, что каждый DTO field annotated и что serializer соблюдает annotation.  
**Решение:** отдельные projection goldens + deny-list/allow-list path assertions; annotation fixture является только входом policy registry.

### C-08 — Version fields ещё не входят в текущие envelope schemas

**Факт:** versioning review предлагает `protocolVersion`, `schemaVersion`, `commandVersion`, но current command schema их не требует, а event имеет только eventVersion.  
**Решение:** не добавлять поля в valid fixtures текущей schema до versioning decision; подготовить fixture namespace/versioned folder и compatibility tests как следующую итерацию.

### C-09 — `scene.spawn_accent` и `scene.spawn_applied`

**Факт:** API перечисляет их, confirmed event list не перечисляет.  
**Решение:** не включать их в authoritative event golden; оставить fixture только для transport/demo после отдельного решения о registry.

## 7. Open questions

- **OQ-01:** Является ли `confirmationToken` обязательным полем payload `gm.rollback_to_checkpoint`, или подтверждение живёт в отдельном session/HTTP handshake? До ответа valid/invalid rollback fixture должен использовать безопасный proposed baseline, но contract нельзя считать окончательно frozen.
- **OQ-02:** Выбрать ли nullable `sceneId` для campaign-scoped events или отдельный non-scene envelope?
- **OQ-03:** Какой утверждённый error code означает “target required” для single-target non-AOE card, если `TARGET_REQUIRED` не добавляется в registry?
- **OQ-04:** Какой exact payload/event semantics у `gm.pause_scene`, включая timer, input window, intent resolution, event name и reconnect?
- **OQ-05:** Где хранится versioned scene visibility policy для условного public HP/status и rounded stamina? Без этого acceptance может проверить только baseline deny paths, но не product-specific reveal.
- **OQ-06:** Какой canonical schema/version negotiation формат принимается (`protocolVersion`, `schemaVersion`, `commandVersion`, snapshot schema)?
- **RESOLVED (DR-C-002):** `intent.conditions/effect/targetRules` are typed in the canonical pre-release `intent.schema.json`; do not treat them as opaque objects.
- **OQ-08:** Какие fields входят в exact GM event payload для raw/final damage и formula version? Current docs требуют GM visibility, но не закрепляют полный schema.
- **OQ-09:** Является ли public HP в Quarantine Gates включённым сценарием policy или только условной возможностью? Fixtures должны не угадывать.
- **OQ-10:** Какой предельный размер `gm.send_hint.text`? Commands review помечает bound как OPEN_QUESTION; fixture не должен закреплять произвольный лимит как gameplay rule.

## 8. Acceptance checks

Перед merge реализации fixtures/contract tests должны пройти:

1. Все valid fixtures проходят соответствующую schema без coercion и без неизвестных полей.
2. Каждый invalid schema fixture отклоняется до scheduler; `sceneRevision`, state, journal и rewards не меняются.
3. Для каждого command из vertical slice есть accepted и rejected path; retry с тем же `requestId` не дублирует event.
4. Stale command выдаёт `STALE_SCENE_REVISION` и не превращается в бесплатное действие.
5. Event fixtures проверяют required metadata, monotonic `serverSequence`, causation и deterministic seed policy.
6. Один authoritative scene fixture даёт согласованные TV, Player-01, Player-02, GM и AI outputs.
7. Ни TV, ни Player, ни AI golden не содержит seed, exact hidden target, fallback pool, audit reason, чужую hand/discard или GM-only lore.
8. Private hint присутствует только у адресата и GM/audit; другие clients не получают даже redacted placeholder event.
9. Reconnect при той же revision возвращает не более подробную projection; rollback notification не раскрывает checkpoint id/reason игроку.
10. Fixed seed + identical checkpoint/commands воспроизводит event order, target tie-break и state hash.
11. Intent duration ниже 3000 ms отклоняется schema; impossible intent domain-test создаёт cancellation/fallback по INTENT-005 без partial effect.
12. Player input не содержит итоговый HP/damage/result; authoritative event создаётся только server simulation после commit.
13. 4-player e2e fixture проходит party setup, reference 3-hero debug fixture остаётся допустимым, один GM enforced.
14. Success/retreat/defeat/rollback fixtures проверяют reward idempotency и полное восстановление state.
15. Каждый golden имеет ссылку на Rule ID/source row и обновляется только через review/Decision Record.
16. Все unresolved conflicts из C-01—C-09 либо решены и отражены в schemas, либо тесты явно помечены blocked/expected-fail с `OPEN_QUESTION`; нельзя замаскировать конфликт изменением fixture.

## 9. Files that must change for implementation

Этот review изменяет только текущий отчёт. Для полноценной реализации потребуется отдельный разрешённый change set:

### Contract/schema files

- `/home/ubuntu/lilovaya-gar/packages/contracts/command.schema.json` — discriminated payloads, bounded fields, возможно version metadata;
- `/home/ubuntu/lilovaya-gar/packages/contracts/event.schema.json` — typed event payloads, policy boundary и решение по nullable `sceneId`;
- `packages/contracts/intent.schema.json` — typed `conditions`, `effect`, `targetRules` and `durationMs` contract, updated for DR-C-002;
- `/home/ubuntu/lilovaya-gar/packages/contracts/visibility.schema.json` — возможно path/policy binding, если это будет принято вместо отдельного registry;
- новые schemas под `/home/ubuntu/lilovaya-gar/packages/contracts/` для command payloads, event payloads, projections и normalized errors;
- новый fixture tree под `/home/ubuntu/lilovaya-gar/packages/contracts/fixtures/`.

### Runtime/serializer files

- `/home/ubuntu/lilovaya-gar/dev/server/CampaignRoom.ts` — transport/auth adapter, routing, event fan-out и reconnect; gameplay validation/mutation/revision delegated to `packages/rules` per DR-C-001;
- `/home/ubuntu/lilovaya-gar/dev/server/index.ts` — HTTP/WS contract routing и safe errors;
- `/home/ubuntu/lilovaya-gar/dev/client/room-client.ts` — только после server contract; client не должен считать state/result;
- новый projection/visibility policy module под `/home/ubuntu/lilovaya-gar/dev/server/` или соответствующий package path;
- расширение существующего headless Core Engine в `packages/rules/src/engine/` по мере прохождения Step C; не помещать gameplay state machine в room adapter.

### Tests/goldens

- новые `packages/contracts/tests/schema.contract.test.ts`;
- новые `packages/contracts/tests/fixtures.contract.test.ts`;
- новые `packages/contracts/tests/visibility.contract.test.ts`;
- новые `packages/contracts/tests/replay.golden.test.ts`;
- новые `packages/contracts/tests/commands.integration.test.ts`;
- новые `packages/contracts/tests/events.integration.test.ts`;
- новые `packages/contracts/tests/acceptance.matrix.test.ts`;
- при принятии e2e — `tests/e2e/quarantine-gates.contract.spec.ts`.

### Documentation/API/DB files

- `/home/ubuntu/lilovaya-gar/docs/03-system-contracts.md` — после решений по event scope, rollback token, pause и error registry;
- `/home/ubuntu/lilovaya-gar/docs/04-visibility-matrix.md` — bind policy paths и conditional reveal;
- `/home/ubuntu/lilovaya-gar/docs/08-api-specification.md` — payload schemas, version negotiation и errors;
- `/home/ubuntu/lilovaya-gar/docs/09-database-schema.md` — если fixtures/replay потребуют explicit snapshot/protocol version columns;
- `/home/ubuntu/lilovaya-gar/docs/07-qa-and-acceptance.md` — добавить matrix IDs и Definition of Done;
- `/home/ubuntu/lilovaya-gar/dev/database/schema.ts` и migration tests — только если database contract changes are approved.

Не следует менять эти файлы в рамках текущего отчёта: список выше является планом будущего implementation change set, а не разрешением изменить CONFIRMED rules.

## 10. Summary decision

Рекомендуется принять fixture-first baseline: typed valid/invalid inputs, authoritative-vs-filtered event separation, one source scene fixture для всех projections, deterministic replay goldens и matrix F-01—F-26. Это покрывает первый vertical slice без добавления игровых правил.

Главный blocker — текущие generic `payload` schemas и несколько уже известных contract conflicts (rollback confirmation, non-scene events, pause semantics, target-required error, version fields). Их нужно решить до того, как contract tests будут объявлены fully passing. До решения эти cases должны оставаться explicit `OPEN_QUESTION`/blocked, а не превращаться в скрытые assumptions.
