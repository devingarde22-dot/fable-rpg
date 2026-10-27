# Fable — Step B Review: Сущности и JSON Schema

**Статус отчёта:** PROPOSAL для реализации; CONFIRMED-правила не изменяются.
**Дата:** 2026-10-27
**Объект review:** каноническая модель сущностей, runtime DTO, projection DTO и JSON Schema.

## 1. Scope

В scope входят только:

- разделение content/template, authoritative runtime state, event/command и filtered projection;
- канонические имена и минимальные поля сущностей, необходимые для первого vertical slice;
- JSON Schema-контракты для этих сущностей и их вложенных объектов;
- согласование сущностей с Rule ID, API, visibility matrix, system contracts и persistence;
- конкретные конфликты и список файлов, которые потребуется изменить при реализации.

Вне scope: новый игровой дизайн, баланс, новые классы/карты/города, процедурная генерация, AI-автоприменение, UI-структура и изменение формул урона. Любое поле или поведение, для которого исходные документы не дают однозначного ответа, помечено `OPEN_QUESTION`.

## 2. Вывод

Каноническая модель должна иметь три разных представления одной предметной области:

1. **Content entities** — версионируемые шаблоны кампании (`NodeTemplate`, `SceneTemplate`, `CardTemplate`, `EnemyTemplate`, `IntentTemplate`). Они не содержат mutable HP, текущую клетку или текущий таймер.
2. **Authoritative runtime entities** — состояние simulation room (`Campaign`, `Expedition/Session`, `Scene`, `SceneEntity`, `HeroRuntime`, `EnemyRuntime`, `DeckState`, `StatusLayer`, `ActiveIntent`, `Checkpoint`). Эти данные являются источником истины только на сервере.
3. **Transport/projection entities** — envelope и role-filtered DTO (`TVSceneProjection`, `PlayerSceneProjection`, `GMSceneProjection`, event payload). Они не должны быть универсальным полным объектом с последующим скрытием полей на клиенте.

Сейчас `command.schema.json` и `event.schema.json` проверяют только envelope, а `payload` объявлен как произвольный object. Это недостаточно для утверждения контракта: сервер может принимать неизвестные поля, а consumer не получает machine-readable гарантию формы сущности. Рекомендуется перейти к discriminated union по `command`/`eventType` с `$defs` для общих сущностей и отдельными payload-схемами.

## 3. Recommended contract

### 3.1 Общие правила идентичности и времени

Все runtime/content сущности должны иметь стабильный opaque `id` и, где нужно для контента, `key`. `id` — внешний идентификатор экземпляра; `key` — стабильный ключ шаблона/контента. Не следует использовать `name` как идентификатор.

Рекомендуемые общие определения:

```json
{
  "$defs": {
    "Id": { "type": "string", "minLength": 1, "maxLength": 160 },
    "Key": { "type": "string", "pattern": "^[a-z][a-z0-9_\\-]*$" },
    "Revision": { "type": "integer", "minimum": 0 },
    "NonNegativeInt": { "type": "integer", "minimum": 0 },
    "Cell": {
      "type": "object", "additionalProperties": false,
      "required": ["x", "y"],
      "properties": {
        "x": { "type": "integer", "minimum": 0 },
        "y": { "type": "integer", "minimum": 0 }
      }
    },
    "Visibility": {
      "type": "string",
      "enum": ["public", "player_private", "gm_only", "conditional", "audit_only"]
    }
  }
}
```

`Cell` должен представлять координату, а не occupancy. Занятость является производным runtime-фактом `SceneEntity.position`; это предотвращает две конкурирующие истины о клетке. Размеры поля и препятствия принадлежат `Scene`/`SceneTemplate`; обязательное ограничение уникальности активной клетки остаётся правилом simulation transaction.

### 3.2 Campaign и Expedition/Session

`Campaign` — долгоживущая кампанийная сущность: `id`, `rulesetVersion`, `kingdomKey`, `gmUserId`, `memberIds`/membership relation, campaign flags/resources и revision. Не следует смешивать её с текущей экспедицией.

`Expedition` — игровой lifecycle от выхода из города до terminal outcome. В persistence это соответствует текущей таблице `sessions`, поэтому каноническое API-имя может быть `session` при условии явного поля `kind: "expedition"` или документационного alias. Минимум:

```json
{
  "id": "exp_01",
  "campaignId": "camp_01",
  "status": "active",
  "terminalOutcome": null,
  "currentNodeId": "node_quarantine_gates",
  "activeSceneId": "scene_01",
  "rulesetVersion": "fable-0.1",
  "revision": 12
}
```

`terminalOutcome` допускает `success | retreat | defeat | gm_abort | technical_recovery` только там, где это разрешено persistence/API. `technical_recovery` присутствует в database schema, но не в confirmed gameplay outcome; его назначение требует OPEN_QUESTION (см. раздел 7).

### 3.3 Route, Node и Scene

`Route`/edge — связь между узлами: `fromNodeId`, `toNodeId`, conditions, cost, risk и visibility. В текущих документах route описан концептуально, но отдельной database table/schema нет. Для первого slice достаточно ссылочного DTO, не требуется полная procedural модель.

`Node` — runtime/projection состояния точки маршрута: `id`, `templateKey`, `visibilityState` (`undiscovered | rumor | discovered | active | completed`), known edges, active scene reference, reward lock state и discovery data. GM-only content не находится в player/TV варианте node.

`Scene` — активное состояние внутри node:

```json
{
  "id": "scene_01",
  "sessionId": "exp_01",
  "nodeId": "node_quarantine_gates",
  "sceneRevision": 41,
  "serverTick": 8820,
  "grid": { "width": 9, "height": 9 },
  "obstacles": [
    { "id": "wall_01", "kind": "wall", "position": { "x": 4, "y": 2 }, "blocksLoS": true }
  ],
  "mode": "active",
  "timePaused": false,
  "entityIds": ["hero_01", "enemy_01"]
}
```

`Scene` не должен содержать одновременно несколько разных authoritative копий полного `publicState` и `gmState`, если projection service уже является контрактом. Persistence может хранить snapshot JSONB, но DTO должны строиться из typed state и visibility policy. `sceneRevision` и `serverTick` обязательны для runtime snapshot; server sequence относится к event, а не к scene entity.

### 3.4 SceneEntity, Hero и Enemy

Рекомендуется общий базовый runtime объект `SceneEntity` с discriminant `kind`:

```json
{
  "id": "enemy_01",
  "kind": "enemy",
  "side": "enemy",
  "position": { "x": 7, "y": 3 },
  "active": true,
  "state": "active",
  "visibility": "public",
  "templateKey": "quarantine_hunter"
}
```

`HeroRuntime` расширяет entity:

- `ownerPlayerId`;
- `hp`, `maxHp`;
- `stamina`, `maxStamina`;
- `defense` и typed stats;
- `mode: out_of_combat | movement | melee_combat | ranged_combat`;
- `deckState`;
- `statusLayers`;
- `retreatImmunityUntil` только в authoritative/GM scope.

`EnemyRuntime` расширяет entity:

- `templateKey`;
- `hp`, `maxHp`, `defense`;
- `statusLayers`;
- `activeIntent` (nullable);
- `targetEntityId` только GM или conditionally revealed;
- internal tie-break/fallback data только GM/audit.

`scene_entities` текущей базы уже содержит большинство полей, но `side`, `state`, `visibility`, `intent` и coordinates нужно привести к enum/object schema. `name` — display field, не identity. HP не должен быть обязательным для препятствия; для hero/enemy — обязательный runtime field.

### 3.5 CardTemplate, CardInstance и DeckState

Нужно строго разделить:

- `CardTemplate`: content (`key`, `name`, category, allowed modes, cost, range, radius, raw effect, status effect, requirements, visibility, version/status);
- `CardInstance`: `instanceId`, `templateKey`, owner hero, source (`equipment | skill | status | backstory | progression`), availability metadata;
- `DeckState`: `drawPile`, `hand`, `defenseSlot`, `discard` как массивы `cardInstanceId`.

Это следует из DECK-001—006: режим меняет filtered availability, а не создаёт новую колоду; карта не исчезает из одного из четырёх контейнеров. Player projection содержит только собственную руку/разрешённый discard и защитный слот; draw pile не передаётся. До входа в бой обычная рука не обязана присутствовать в projection, но authoritative deck существует.

`mode` у CardTemplate не должен быть одиночной строкой, если универсальная карта допустима. Рекомендуемое поле — `allowedModes: ["melee", "ranged", "movement"]`, при этом фактическая доступность определяется серверным фильтром. Это уточнение структуры, не новое gameplay rule.

### 3.6 StatusLayer

Каноническая форма должна непосредственно отражать STATUS-001/002:

```json
{
  "statusKey": "immobilized",
  "sourceId": "enemy_03",
  "potency": 1,
  "appliedAtTick": 8400,
  "expiresAtTick": 8700,
  "stackIndex": 0,
  "category": "control",
  "removal": { "kind": "expiry" }
}
```

Для wall-clock API можно дополнительно сериализовать ISO timestamps, но в simulation authoritative timer должен быть tick-based или иметь однозначное server-time представление. Нельзя молча складывать potency/duration при повторном наложении. `potency` должен быть числом с явно задокументированной единицей/шкалой; если для конкретного статуса нужен иной cap, это content rule.

### 3.7 IntentTemplate и ActiveIntent

Текущий `intent.schema.json` является шаблоном, но не runtime active intent. Разделение:

- `IntentTemplate`: `key`, `version/status`, `icon`, `durationMs`, typed `conditions`, `effect`, `fallbackKeys`, `targetRules`, visibility;
- `ActiveIntent`: `activeIntentId`, `templateKey`, `ownerEntityId`, lifecycle state, `startedAtTick`, `resolvesAtTick`, selected target ID/cell, optional approved public target cell, `seedRef`, and `cancelReason`.

`targetEntityId`, exact conditions and tie-break/seed details are not sent to Player/TV. Public projection contains icon/remaining timer; target cell/area is included only after explicit visibility/reveal approval and otherwise omitted. `conditions/effect/targetRules` are typed in the confirmed pre-release schema per [DR-C-002](../15-step-c-intent-simulation.md), superseding the earlier opaque-object proposal.

### 3.8 Checkpoint, Consequence и Hint

`Checkpoint` должен быть typed metadata плюс versioned opaque snapshot:

```json
{
  "id": "checkpoint-city-before-quarantine-01",
  "campaignId": "camp_01",
  "sessionId": "exp_01",
  "sceneId": null,
  "lastEventSequence": 40,
  "rulesetVersion": "fable-0.1",
  "seedState": { "algorithm": "xoshiro128**", "algorithmVersion": "fable.rng.v1", "rootSeed": "root_seed_01" },
  "snapshotVersion": 1,
  "createdBy": "gm_01"
}
```

Snapshot не является player DTO и выдаётся только GM/restore service. `rollback.applied` должен ссылаться на checkpoint, но player-safe notification не раскрывает `checkpointId` согласно visibility matrix.

`Consequence` — GM-confirmed state change с `proposalId`, `editedPayload`, `reason` и server-validated allowed fields. Proposal и applied consequence не должны быть одним типом: AI proposal не event и не mutation.

`Hint` — private event с `fromGmId`, `targetPlayerId`, `text`, `vibration`, delivery metadata. Для player projection target player видит hint, остальные — отсутствие объекта, а не redacted полный hint.

### 3.9 Projection contract

Нужны отдельные discriminated DTO:

- `TVSceneProjection`: public cells/obstacles, public entity positions, allowed HP, public status subset, telegraph icon/timer and target cell/area only when visibility/reveal policy explicitly approves it, public events;
- `PlayerSceneProjection`: TV-safe fields плюс own hero full allowed state, own hand, defense slot, own stamina/HP, available targets, private hints;
- `GMSceneProjection`: full authorized runtime state, exact intents/targets, all decks/discards, seed, audit and lore;
- `AIContextPacket`: explicit allow-listed packet, не generic `GMSceneProjection`.

Каждое поле projection должно иметь visibility annotation или попадать в named DTO, а backend должен фильтровать до сериализации. `visibility.schema.json` подходит как annotation primitive, но не заменяет schemas самих DTO.

### 3.10 Command и Event envelope

Envelope сохраняется, но `payload` должен быть discriminated:

```json
{
  "command": "player.move",
  "payload": { "direction": "up" }
}
```

Рекомендуется `oneOf`/`$defs` с `const` для каждого command. Минимально нужны payload schemas для всех команд vertical slice, включая `gm.create_checkpoint` и `gm.pause_scene`, если они остаются в API.

Event должен иметь typed payload per `eventType`, включая `scene.entity_moved`, `card.played`, `status.applied`, `intent.started`, `intent.cancelled`, `intent.resolved`, `checkpoint.created`, `rollback.applied` и `expedition.ended`. `seed` остаётся server-only field в GM/audit projection; наличие nullable `seed` в общей event envelope не должно означать его сериализацию игроку.

## 4. Examples

### 4.1 Player snapshot до боя

```json
{
  "projection": "player",
  "sceneRevision": 41,
  "scene": {
    "id": "scene_01",
    "grid": { "width": 9, "height": 9 },
    "entities": [
      { "id": "hero_01", "kind": "hero", "position": { "x": 1, "y": 8 }, "hp": 1100, "maxHp": 1100, "mode": "movement" },
      { "id": "enemy_01", "kind": "enemy", "position": { "x": 7, "y": 3 }, "publicIntent": { "icon": "move", "remainingMs": 8200 } }
    ],
    "movement": { "directions": ["up", "left"] },
    "hand": null,
    "defenseSlot": null
  }
}
```

Наличие `hand: null` — часть DTO semantics только если это заранее выбрано; альтернативно поле должно отсутствовать. Нельзя отправлять скрытые карты под null/маскировкой внутри общего объекта.

### 4.2 Player snapshot в бою

```json
{
  "projection": "player",
  "sceneRevision": 52,
  "hero": {
    "id": "hero_01",
    "mode": "melee_combat",
    "hp": 1030,
    "maxHp": 1100,
    "stamina": 0,
    "maxStamina": 4,
    "hand": [
      { "instanceId": "ci_01", "templateKey": "quick_strike", "cost": 0 },
      { "instanceId": "ci_02", "templateKey": "arcane_burst", "cost": 2 }
    ],
    "defenseSlot": { "instanceId": "ci_07", "templateKey": "guard" },
    "statuses": [{ "statusKey": "immobilized", "expiresAtTick": 8700 }]
  },
  "availableTargets": ["enemy_01"]
}
```

`availableTargets` — разрешённый результат серверного фильтра, не обещание, что target останется доступен после следующего revision.

### 4.3 Event `status.applied` в GM projection

```json
{
  "eventId": "evt_91",
  "eventType": "status.applied",
  "eventVersion": 1,
  "sceneId": "scene_01",
  "sceneRevision": 53,
  "serverTick": 9000,
  "serverSequence": 91,
  "actorId": "enemy_03",
  "causedByRequestId": null,
  "payload": {
    "targetEntityId": "hero_01",
    "status": {
      "statusKey": "immobilized",
      "sourceId": "enemy_03",
      "potency": 1,
      "appliedAtTick": 9000,
      "expiresAtTick": 9300,
      "stackIndex": 0,
      "category": "control"
    }
  }
}
```

Player может получить redacted/public subset этого payload, а TV — только public status/VFX, если это разрешено сценарием. Один и тот же raw payload нельзя broadcast всем ролям.

## 5. Affected Rule IDs

- `PARTY-001`, `PARTY-002`, `PARTY-003`: ownership, единственный GM и role-specific projections.
- `TIME-001`—`TIME-005`: server authority, revisions, ticks, ordering и stale commands.
- `MOVE-001`—`MOVE-005`: `Cell`, occupancy, hero mode и retreat immunity.
- `DECK-001`—`DECK-008`: CardTemplate/Instance/DeckState, containers, mode filtering, cost.
- `COMBAT-001`—`COMBAT-006`: target references, range/LoS и серверный damage result.
- `RESOURCE-001`—`RESOURCE-003`: HP/stamina runtime fields и server timer.
- `STATUS-001`—`STATUS-004`: typed StatusLayer, expiry, potency/stack semantics.
- `INTENT-001`—`INTENT-006`: EnemyRuntime, IntentTemplate/ActiveIntent, fallback и seed-based target choice.
- `MAP-001`—`MAP-004`: Node/Scene/Route/Expedition lifecycle, discovery, retreat/defeat.
- `SAVE-001`, `SAVE-002`: Checkpoint snapshot, restore и audit-only rollback data.
- `GM-001`—`GM-003`: consequence, private hint, proposal/event separation.
- `VIS-*` и system-contracts §7: role DTO, field-level filtering и no leakage.

## 6. Conflicts and concrete resolutions

### C-01 — Envelope schemas не типизируют payload

`command.schema.json:28` и `event.schema.json:19` используют `{ "type": "object" }`. Это конфликтует с API requirement schema validation и с принципом каждого server command/event иметь проверяемый контракт.

**Resolution:** заменить generic payload на discriminated `oneOf`/`$defs`; добавить отдельные payload schemas. До этого статус — `OPEN_QUESTION` только для тех payload effect DSL, которые не описаны документами; формы команд vertical slice уже достаточно определены.

### C-02 — API commands/events шире system-contracts

API перечисляет `gm.create_checkpoint`, `gm.pause_scene`, `scene.spawn_accent`, `scene.spawn_applied`, а system contracts §3/§4 не дают им envelope payload/event semantics. System contracts, в свою очередь, перечисляют `card.discarded`, `mode.changed`, `scene.ended`, `scene.transferred`, которых нет в API event list.

**Resolution:** сделать единый registry command/event types и явно включить/исключить каждый тип. Для checkpoint и pause определить payload/state machine; для spawn определить, является ли это разрешённым slice event. Пока registry не согласован — эти типы нельзя считать полностью реализуемыми.

### C-03 — Intent schema смешивает template и runtime

`intent.schema.json` валидирует `key/icon/durationMs/...`, но не `intentId`, owner, lifecycle state, server timer или exact target. Это расходится с INTENT-001—005 и system state machine.

**Resolution:** сохранить intent schema как `IntentTemplate`, создать `active-intent` schema и запретить использовать template object как runtime entity.

### C-04 — Visibility annotation не обеспечивает projection safety

`visibility.schema.json` описывает одну аннотацию, но `event.schema.json`, `intent.schema.json` и остальные DTO не требуют visibility на полях и не различают TV/player/GM output. Общий event envelope допускает `seed` и `actorId` без role policy.

**Resolution:** named projection schemas плюс backend filtering before serialization. Для каждого условного поля определить reveal condition и redaction; отсутствие поля предпочтительнее fake/null hidden object. Обязателен negative test на seed/exact target/foreign hand.

### C-05 — Database runtime JSONB не совпадает с typed entity model

`characters.cards`/`statuses`, `scenes.public_state`/`gm_state`, `scene_entities.intent` объявлены generic JSONB. Это допустимо как persistence snapshot, но не как канонический API schema; иначе разные writers могут записывать несовместимые формы.

**Resolution:** задать TypeScript/JSON Schema types для JSONB, добавить `snapshotVersion`, и валидировать payload при write/read. `gm_state` никогда не выбирать в player/TV DTO; authoritative typed simulation остаётся первичной моделью.

### C-06 — Session/Expedition naming и outcome conflict

Glossary говорит «Экспедиция», API использует session/expedition, database `sessions` добавляет `technical_recovery`, тогда как confirmed outcomes перечисляют success/retreat/defeat/gm_abort.

**Resolution:** зафиксировать alias (`Session` persistence = `Expedition` domain) и вынести `technical_recovery` в технический lifecycle outcome либо оформить Decision Record. Не добавлять его в player-facing gameplay enum без решения.

### C-07 — Schema/API command consistency

`command.schema.json` enum включает `gm.pause_scene`, но system contract §3 не описывает его payload; API также обещает `gm.create_checkpoint`, хотя в system contract command examples нет payload. `player.enter_movement_mode` присутствует в API и schema, но в system contracts описан как `player.enter_movement_mode` без отдельной payload schema.

**Resolution:** добавить explicit payload `{}` для no-argument commands и описать pause/checkpoint state transitions, authorization, events и idempotency. Если pause не входит slice, удалить его из registry отдельным согласованным изменением, а не оставлять ложным контрактом.

### C-08 — Event version/revision semantics недостаточно связаны с entity snapshot

Envelope требует `sceneRevision`, но schema не требует `causedByRequestId`/`actorId` даже когда event должен быть causally linked; DB schema допускает nullable request id. Это не обязательно ошибка для scheduler/system events, но сейчас не различаются command-caused и server-tick events.

**Resolution:** оставить nullable только для scheduler-generated events, но добавить event registry metadata: `causedByRequestId` required/optional per event type, visibility policy, payload schema и whether seed is allowed. Это предотвратит неявное расширение envelope.

## 7. Open questions

1. **OPEN_QUESTION:** `Session` и `Expedition` — один domain type с persistence alias или два самостоятельных lifecycle объекта? Нужен один canonical name в TypeScript/API.
2. **OPEN_QUESTION:** `technical_recovery` — технический audit outcome или публичный terminal outcome? Решить до фиксации enum schema.
3. **OPEN_QUESTION:** является ли `Node` полноценной runtime сущностью с отдельным id/state или только projection над `node_template` + campaign discovery state? Для slice достаточно projection, production persistence требует решения.
4. **OPEN_QUESTION:** какая точная DSL-форма у `IntentTemplate.conditions`, `effect`, `targetRules` и у `CardTemplate.rawEffect/statusEffect`? До решения нельзя безопасно сделать их строгими nested schemas; arbitrary object допустим только как временный versioned content blob.
5. **OPEN_QUESTION:** должен ли `mode` сцены быть одним enum (`active/paused/...`) или API `gm.pause_scene` меняет отдельное `timePaused` без смены gameplay mode?
6. **OPEN_QUESTION:** какой формат server timer каноничен для DTO: `serverTick`, absolute server timestamp, `remainingMs`, или комбинация? Нельзя полагаться на client wall clock для правил.
7. **OPEN_QUESTION:** допускается ли `visibility: conditional` с несколькими ролями и explicit reveal event, или condition должен быть отдельным typed object вместо строки?
8. **OPEN_QUESTION:** следует ли хранить `ownerPlayerId` на HeroRuntime, если membership/character relation уже существует, и как кодируется debug party из 3 героев без нарушения PARTY-001?
9. **OPEN_QUESTION:** API event list содержит spawn events, но текущий confirmed slice не определяет spawn/accent mechanics. Нужны либо их полные контракты, либо исключение из slice registry.
10. **OPEN_QUESTION:** `hand: null` до входа в бой и отсутствие `hand` — разные wire semantics. Выбрать один вариант и закрепить golden snapshot.

## 8. Acceptance checks

### Schema and registry

- [ ] JSON Schema validator rejects unknown command payload fields and accepts every documented vertical-slice command.
- [ ] JSON Schema validator rejects an event payload under the wrong `eventType`.
- [ ] Every registry command has role, payload schema, idempotency behavior, affected state and emitted event list.
- [ ] Every registry event has payload schema, `eventVersion`, visibility policy and seed/causality policy.
- [ ] `IntentTemplate` and `ActiveIntent` validate as different types.
- [ ] `CardTemplate`, `CardInstance` and `DeckState` cannot be confused by missing discriminants.

### Simulation and persistence

- [ ] Two active entities cannot occupy one cell in one transaction/batch.
- [ ] Stale `sceneRevision` cannot mutate `Scene`, `HeroRuntime`, `EnemyRuntime`, `DeckState` or statuses.
- [ ] A repeated `requestId` emits no duplicate event or reward.
- [ ] Fixed seed produces identical target tie-break/result and seed is persisted in GM/audit scope.
- [ ] Checkpoint restore reconstructs route/node/scene/HP/stamina/status/deck state and does not duplicate reward.
- [ ] JSONB persistence payloads validate against the same versioned entity schema as runtime snapshots.

### Visibility and projections

- [ ] TV receives no exact enemy target, seed, draw pile, audit reason, foreign hand or GM lore.
- [ ] Player receives own full allowed hero/deck data but no other player hand/discard or GM-only fields.
- [ ] Reconnect returns the same role-filtered projection and does not increase visibility.
- [ ] Private hint is delivered only to target player and GM.
- [ ] Rollback notification to players does not reveal checkpoint id or audit reason.
- [ ] AI context contains only explicitly allowed packet fields, never a full GM snapshot by default.
- [ ] Negative tests inspect serialized JSON, not only UI rendering.

### Vertical slice golden checks

- [ ] 9×9 scene validates with two walls, one statue/barrier, player start cells and three enemy positions.
- [ ] Movement projection shows arrows before battle and five ordinary cards plus one defense slot in battle.
- [ ] Zero-cost card is accepted at zero stamina; positive-cost card is rejected.
- [ ] Immobilized status blocks movement for the configured 15 seconds without implicitly blocking protection/cards.
- [ ] Intent telegraph exposes icon and red target cell/area but not exact hidden target/formula.
- [ ] Success/retreat/defeat/gm_abort transitions validate reward-lock and checkpoint behavior.

## 9. Files that will need changes (implementation phase; not changed by this review)

### Contracts

- `/home/ubuntu/lilovaya-gar/packages/contracts/command.schema.json` — replace generic payload with command discriminated union and add explicit payload schemas.
- `/home/ubuntu/lilovaya-gar/packages/contracts/event.schema.json` — replace generic payload with event registry/payload union; define seed/causality policy.
- `/home/ubuntu/lilovaya-gar/packages/contracts/intent.schema.json` — clarify as template schema and add/point to active-intent schema.
- `/home/ubuntu/lilovaya-gar/packages/contracts/visibility.schema.json` — likely add structured condition/reference semantics, or document it as annotation-only.
- New contract files recommended: `common.schema.json`, `entity.schema.json`, `scene.schema.json`, `hero.schema.json`, `enemy.schema.json`, `card.schema.json`, `status.schema.json`, `active-intent.schema.json`, `projection.schema.json`, and `registry` schemas. Exact filenames are an implementation decision.

### Documentation and API

- `/home/ubuntu/lilovaya-gar/docs/03-system-contracts.md` — unify command/event registry, payload shapes and projection entity names.
- `/home/ubuntu/lilovaya-gar/docs/04-visibility-matrix.md` — annotate every new DTO field and conditional reveal semantics.
- `/home/ubuntu/lilovaya-gar/docs/08-api-specification.md` — align API command/event lists with registry and add typed snapshot/projection references.
- `/home/ubuntu/lilovaya-gar/docs/09-database-schema.md` — map typed entity JSONB, snapshot version and Session/Expedition naming/outcome decision.
- `/home/ubuntu/lilovaya-gar/docs/01-glossary.md` — add canonical distinction between template, instance, runtime entity, active intent and projection after decisions.
- `/home/ubuntu/lilovaya-gar/docs/02-confirmed-rules.md` — only if a Decision Record resolves one of the marked OPEN_QUESTION items; do not silently edit confirmed semantics.

### Runtime and persistence

- `packages/rules/src/engine/` entity/state types and validators — extend the authoritative headless model and invariant checks per DR-C-001; server remains an adapter.
- projection/filter service — generate TV/Player/GM/AI DTOs before serialization.
- event/command registry and handlers — bind discriminated schemas to authorization, revision and emitted events.
- database schema/migrations and typed JSONB definitions — only after the entity contract and Decision Records are approved.
- unit, simulation, replay, visibility and e2e tests — one golden/negative test per affected contract and Rule ID.

## 10. Non-changes made in this task

Создан только этот review-файл. Product constitution, glossary, confirmed rules, system contracts, visibility matrix, vertical slice, API specification, database schema, AI guide и все существующие JSON Schema не изменялись.
