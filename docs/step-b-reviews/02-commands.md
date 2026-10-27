# Step B Review 02 — Commands и входные payload

**Статус:** PROPOSAL для реализации; подтверждённые правила и gameplay semantics не изменяются.
**Объект проверки:** command envelope, payloads, preconditions, ошибки, идемпотентность, revision, visibility и соответствие vertical slice.
**Источники:** product constitution, glossary, confirmed rules, system contracts, visibility matrix, vertical slice, API specification, database schema, AI developer guide и четыре JSON Schema.

## 1. Scope

В scope этого отчёта входят только команды, входные payloads, серверные preconditions и безопасные error codes для первого vertical slice. Рассматриваются player-команды движения/режимов/карт и GM-команды подсказки, consequence, исхода, checkpoint, rollback и pause, поскольку именно они уже перечислены в `command.schema.json` и API.

Вне scope: новые игровые механики, баланс, формулы урона, контент карт, новые intent-правила, UI-дизайн, полная auth-модель, production rate limits и реализация database migrations. Любое решение, для которого текущие документы не дают однозначного ответа, помечено `OPEN_QUESTION`.

## 2. Recommended contract

### 2.1 Канонический envelope

Каждый command должен приходить в следующем envelope:

```ts
type CommandEnvelope<TPayload> = {
  requestId: string;       // opaque, уникален в пределах campaign/session
  sessionId: string;
  actorId: string;         // authenticated user/device actor, не произвольный герой
  role: "player" | "gm";
  command: CommandName;
  payload: TPayload;
  clientRevision: number;  // последняя известная sceneRevision
  clientSentAt?: string;   // ISO date-time, только telemetry
};
```

`requestId`, `sessionId`, `actorId`, `role`, `command`, `payload`, `clientRevision` обязательны. `clientSentAt` не участвует в правилах и не должен приниматься за server time. `actorId` и `role` берутся из аутентифицированной session/membership; сервер не доверяет этим полям как доказательству права.

**Рекомендация:** в TypeScript ввести discriminated union по `command`, а в JSON Schema — отдельные payload definitions с `additionalProperties: false`. Текущий общий `payload: { type: "object" }` недостаточен: он пропускает неизвестные поля, отсутствующие обязательные поля и неправильный payload для конкретной команды.

### 2.2 Command matrix

| Command | Role | Payload | Успешный результат/событие | Основные preconditions |
|---|---|---|---|---|
| `player.move` | player | `{direction}` | `scene.entity_moved`, при выходе из melee — retreat resolution и связанные events | ownership, scene revision, режим, lock/status, ортогональная соседняя клетка, свободная клетка |
| `player.play_card` | player | `{cardInstanceId, targetEntityId?, targetCell?, mode, clientCardRevision}` | `card.played` и производные `hp.changed`, `status.*`, `stamina.changed`, `mode.changed` | ownership, revision, card container/filter, card revision, mode, stamina, target/LoS/range |
| `player.enter_movement_mode` | player | `{}` | `mode.changed`; из melee также retreat events | ownership, revision, state permits, command is not a card |
| `player.enter_ranged_mode` | player | `{}` | `mode.changed` | ownership, revision, at least one filtered ranged card, state permits |
| `gm.send_hint` | gm | `{targetPlayerId,text,vibration}` | private `hint.sent` | sole GM membership, target member, non-empty bounded text, active campaign/session |
| `gm.apply_consequence` | gm | `{proposalId,editedPayload,reason}` | journal/consequence events | sole GM, proposal ownership/status, current revision if scene-bound, payload/content refs, explicit confirmation |
| `gm.end_expedition` | gm | `{outcome,consequenceId?,createCitySave,reason}` | `expedition.ended`, optionally checkpoint/city-save | active expedition, outcome state machine, consequence compatibility, reward idempotency |
| `gm.create_checkpoint` | gm | `{label,reason}` | `checkpoint.created` | sole GM, active valid campaign/session, serializable authoritative state |
| `gm.rollback_to_checkpoint` | gm | `{checkpointId,confirmationToken,reason}` | `rollback.applied` + filtered snapshot | sole GM, valid token, checkpoint access, rollback policy, campaign/session lock |
| `gm.pause_scene` | gm | `{paused}` | pause state event (event name must be fixed) | sole GM, scene active, pause policy and current transition allow it |

`targetEntityId` и `targetCell` не являются одинаково обязательными для всех карт: сервер определяет требование по card template. Поэтому schema должна разрешать их optional, но domain validator обязан требовать ровно нужные поля после загрузки карты.

### 2.3 Payload definitions

#### `player.move`

```json
{
  "direction": "up"
}
```

`direction` — enum `up | down | left | right`. Координаты и итоговая клетка не входят во вход: клиент не может навязать позицию. Сервер вычисляет соседнюю клетку по authoritative position.

Preconditions: actor владеет героем в session; `clientRevision === current sceneRevision` (или применяется единая документированная политика допуска, см. OPEN_QUESTION); hero не тяжело ранен/заблокирован; текущий personal mode допускает move; destination внутри 9×9/актуальной grid; destination свободен от врага, союзника и препятствия; anti-reentry immunity и иные scene rules проверены. Перемещение не тратит stamina.

#### `player.play_card`

```json
{
  "cardInstanceId": "card-instance-123",
  "targetEntityId": "enemy-2",
  "targetCell": { "x": 7, "y": 3 },
  "mode": "melee",
  "clientCardRevision": 4
}
```

Рекомендуемый schema: `cardInstanceId` required; `mode` enum `melee | ranged | movement`; `clientCardRevision` integer `>= 0`; `targetEntityId` и `targetCell` optional, с `oneOf`/условной domain-проверкой. Для self/AOE/безцелевой карты target может отсутствовать; для single-target карты сервер возвращает безопасную ошибку `TARGET_REQUIRED`, если target не передан. `targetCell` — намерение/выбранная клетка, не итог попадания и не источник урона; сервер перепроверяет её по карте и state.

Preconditions: карта принадлежит actor-герою и находится в разрешённом hand/defense slot согласно типу; не находится в draw pile/discard; `clientCardRevision` совпадает с актуальной версией player card projection; режим карты совместим с текущим mode; карта доступна после фильтра режима, дистанции, skill/equipment/status; stamina достаточна, кроме cost `0`; состояние героя не запрещает действие; target существует и видим/разрешён для данного игрока; range и LoS проходят; карта/intent не expired. Клиент никогда не передаёт rawDamage/finalDamage/hit/result.

#### `player.enter_movement_mode`

Payload — пустой объект `{}`. Команда не зависит от наличия карты. В melee сервер запускает retreat resolution и бесплатные базовые атаки окружающих врагов по MOVE-004/COMBAT-006, затем переводит героя в movement. Вне melee просто меняет personal mode. Входное поле `force`, destination или attack result запрещено.

#### `player.enter_ranged_mode`

Payload — `{}`. Preconditions: ownership, fresh revision, state allows mode change, в фильтрованной колоде есть хотя бы одна доступная дальняя карта. Карты автоматически не разыгрываются. Если дальняя карта отсутствует, отказ не должен раскрывать состав draw pile или скрытые причины; достаточно `INVALID_MODE` с безопасным сообщением.

#### `gm.send_hint`

```json
{
  "targetPlayerId": "player-2",
  "text": "Проверь клетку за статуей.",
  "vibration": true
}
```

`targetPlayerId` required; `text` required, non-empty, bounded (конкретный максимум — OPEN_QUESTION или общий API limit); `vibration` required boolean. Только authenticated sole GM может отправить hint участнику той же campaign/session. Event visibility — private target player + GM/audit; TV и другие players не получают ни текст, ни факт адресной подсказки.

#### `gm.apply_consequence`

```json
{
  "proposalId": "proposal-123",
  "editedPayload": {
    "journalText": "Игроки спасли свидетеля"
  },
  "reason": "Игроки спасли свидетеля"
}
```

Текущий `editedPayload: {}` нельзя считать контрактом. Рекомендуется валидировать его против versioned consequence/proposal schema и разрешённого списка полей конкретного proposal; произвольные state fields (`hp`, `reward`, `node`, `status`, `seed`) запрещены. `proposalId` должен существовать, быть доступен текущей campaign и иметь status `proposed`/разрешённый для подтверждения. Сервер повторно проверяет content references, current revision, GM permission и обязательное explicit confirmation. AI proposal не становится событием и не меняет state до этой команды.

#### `gm.end_expedition`

```json
{
  "outcome": "success",
  "consequenceId": "consequence-1",
  "createCitySave": true,
  "reason": "Сцена завершена GM"
}
```

`outcome` enum `success | retreat | defeat | gm_abort`; `consequenceId` required только если outcome/state machine требует consequence; `createCitySave` boolean; `reason` bounded string, GM/audit only. Сервер проверяет active expedition, terminal transition, совместимость consequence, отсутствие ранее применённого outcome и reward idempotency. `retreat` и `defeat` закрывают награды; `success` не должен выдавать награду дважды; `gm_abort` требует явной причины.

#### `gm.create_checkpoint`

Рекомендуемый payload:

```json
{
  "label": "city-before-quarantine-01",
  "reason": "Перед входом в карантинные ворота"
}
```

Это согласует API/vertical slice с command enum. Checkpoint должен содержать authoritative snapshot, last event sequence, ruleset version и seed state на сервере; клиент не передаёт snapshot, reward или revision. `label` и `reason` — bounded audit fields.

#### `gm.rollback_to_checkpoint`

```json
{
  "checkpointId": "checkpoint-city-mirevalt-01",
  "confirmationToken": "confirm-opaque-token",
  "reason": "Возврат после технической ошибки"
}
```

`confirmationToken` обязателен именно в command payload либо должен быть явно объявлен session-level подтверждением; текущие документы расходятся. До решения этого вопроса реализация должна остановиться на `OPEN_QUESTION`, а безопасный baseline — требовать token. Сервер проверяет GM membership, принадлежность checkpoint campaign/session, token scope/expiry, lock campaign/session, затем восстанавливает полное состояние, увеличивает revision, пишет rollback audit и рассылает новый filtered snapshot. Игрокам нельзя раскрывать `checkpointId`, audit reason или скрытый rollback source.

#### `gm.pause_scene`

Рекомендуемый payload `{ "paused": true }` или `{ "paused": false }`, но semantics pause не подтверждены в Rule IDs/vertical slice. До отдельного решения это только schema/API placeholder: команда не должна менять simulation timers, input windows или state. Рекомендуется пометить command `OPEN_QUESTION`/disabled в runtime, пока не определены permission, timer behavior, events и reconnect behavior.

### 2.4 Preconditions и порядок проверки

Сервер должен применять единый pipeline:

1. transport/authentication и membership;
2. envelope schema и command-specific payload schema;
3. command-role/ownership check;
4. requestId idempotency lookup;
5. scene/session existence и command scope;
6. `clientRevision`/current revision check;
7. current mode, state locks, terminal state и timer checks;
8. entity/card/target/content reference checks;
9. geometric checks: cell, range, LoS, occupancy;
10. resource/status checks;
11. deterministic batch reservation and simulation;
12. transaction: state mutation + append-only event + command result;
13. filtered projection/broadcast.

Скрытая причина отказа не должна менять публичный код на более информативный. GM/audit может хранить diagnostic detail, но player/TV получают только safeMessage.

### 2.5 Idempotency и stale behavior

`requestId` уникален и сохраняется в `command_requests`; повтор того же requestId возвращает сохранённый результат и не создаёт новый event. Если тот же requestId приходит с другим command/payload, рекомендуется `DUPLICATE_REQUEST` без выполнения второй версии.

Любой rejected stale command не меняет gameplay state, `sceneRevision` или domain journal и не становится бесплатным действием; authoritative `serverTick` может продолжать идти независимо. В успешном `CommandResult` возвращаются `requestId`, `acceptedAt`, `eventIds`, новый `sceneRevision`; в rejection — `requestId`, safe `code`, актуальный `sceneRevision`, safeMessage. Точный тип `acceptedAt` следует унифицировать: system contract использует number, transport docs не фиксируют единицы.

### 2.6 Error codes

Существующий список следует сохранить и расширить минимально необходимыми кодами:

- `AUTH_FORBIDDEN` — role/session/membership/ownership запрещает command;
- `STALE_SCENE_REVISION` — clientRevision устарел;
- `DUPLICATE_REQUEST` — requestId уже обработан или конфликтует с другим payload;
- `INVALID_MODE` — команда/карта несовместима с personal mode или доступными картами;
- `CELL_BLOCKED` — destination занята или заблокирована;
- `TARGET_NOT_VISIBLE` — target не входит в разрешённую player visibility;
- `TARGET_REQUIRED` — карта требует explicit target, но он не указан;
- `TARGET_INVALID` — target не существует/не подходит карте без раскрытия hidden detail;
- `TARGET_OUT_OF_RANGE` — target вне range;
- `LINE_OF_SIGHT_BLOCKED` — LoS не проходит;
- `CARD_NOT_AVAILABLE` — карта не в разрешённом контейнере/фильтре;
- `CARD_REVISION_STALE` — clientCardRevision устарел;
- `INSUFFICIENT_STAMINA` — недостаточно stamina;
- `STATE_LOCKED` — heavy wound, immobilization или другой lock запрещает действие;
- `INTENT_EXPIRED` — intent/timer больше не актуален;
- `NODE_NOT_DISCOVERED` — action требует неизвестный узел;
- `OUTCOME_ALREADY_APPLIED` — expedition уже terminal;
- `CHECKPOINT_NOT_FOUND` — checkpoint отсутствует или недоступен этому GM;
- `ROLLBACK_CONFIRMATION_REQUIRED` — token отсутствует/не подтверждён;
- `SCHEMA_INVALID` — envelope или command-specific payload не прошёл schema.

`TARGET_REQUIRED`, `TARGET_INVALID` и `CARD_REVISION_STALE` — новые proposed codes, потому что без них невозможно различать типовые rejection cases без перегрузки существующих кодов. Если project policy запрещает расширять enum без ADR, эти три кода должны быть `OPEN_QUESTION`, а до решения использовать ближайший безопасный код с GM/audit detail.

SafeMessage examples:

```json
{
  "ok": false,
  "requestId": "req_01",
  "code": "STALE_SCENE_REVISION",
  "sceneRevision": 42,
  "safeMessage": "Состояние сцены изменилось. Обновите экран."
}
```

Для `TARGET_NOT_VISIBLE`, `CARD_NOT_AVAILABLE`, hidden intent и GM-only content нельзя сообщать exact target, draw pile, скрытый condition, seed или внутреннюю причину.

## 3. Examples

### Успешное перемещение

```json
{
  "requestId": "req-move-001",
  "sessionId": "sess-01",
  "actorId": "user-player-02",
  "role": "player",
  "command": "player.move",
  "payload": { "direction": "right" },
  "clientRevision": 41,
  "clientSentAt": "2026-10-27T00:00:00Z"
}
```

Сервер сам вычисляет destination и создаёт `scene.entity_moved`; клиент не присылает x/y, HP, damage или event.

### Некорректный payload карты

```json
{
  "requestId": "req-card-002",
  "sessionId": "sess-01",
  "actorId": "user-player-02",
  "role": "player",
  "command": "player.play_card",
  "payload": {
    "cardInstanceId": "card-instance-123",
    "mode": "ranged",
    "rawDamage": 99999,
    "targetEntityId": "enemy-2"
  },
  "clientRevision": 41
}
```

Command-specific `additionalProperties: false` возвращает `SCHEMA_INVALID`; `rawDamage` никогда не принимается и не отражается обратно в safeMessage.

### Rollback

```json
{
  "requestId": "req-rb-001",
  "sessionId": "sess-01",
  "actorId": "user-gm-01",
  "role": "gm",
  "command": "gm.rollback_to_checkpoint",
  "payload": {
    "checkpointId": "checkpoint-city-mirevalt-01",
    "confirmationToken": "confirm-opaque-token",
    "reason": "Возврат после технической ошибки"
  },
  "clientRevision": 41
}
```

Player не должен получить `checkpointId`, token или audit reason в rollback notification; ему отправляется только новый filtered snapshot и безопасное уведомление.

### Private hint

```json
{
  "requestId": "req-hint-001",
  "sessionId": "sess-01",
  "actorId": "user-gm-01",
  "role": "gm",
  "command": "gm.send_hint",
  "payload": {
    "targetPlayerId": "player-2",
    "text": "Проверь клетку за статуей.",
    "vibration": true
  },
  "clientRevision": 41
}
```

Event/projection visibility: target player + GM; TV и player-1 не получают payload, event existence или sender reason.

## 4. Affected Rule IDs

- `PARTY-001`, `PARTY-002`, `PARTY-003` — 2–4 players, один GM, ownership и role checks.
- `TIME-001`, `TIME-003`, `TIME-004`, `TIME-005` — server authority, 250 ms input window, deterministic ordering, stale rejection.
- `MOVE-001`, `MOVE-002`, `MOVE-003`, `MOVE-004`, `MOVE-005` — move payload без client coordinates, mode/retreat preconditions.
- `DECK-003`, `DECK-004`, `DECK-005`, `DECK-006`, `DECK-007` — card container/filter/cost validation.
- `COMBAT-001`, `COMBAT-002`, `COMBAT-003`, `COMBAT-005`, `COMBAT-006` — target, range, LoS, server result и retreat attacks.
- `RESOURCE-002` — move не тратит stamina; card cost server-validated.
- `STATUS-003`, `STATUS-004` — state locks для heavy wound/immobilization.
- `INTENT-002`, `INTENT-003`, `INTENT-005` — timer/server result, hidden exact intent и cancellation.
- `MAP-001`, `MAP-003`, `MAP-004` — scene scope, retreat/defeat outcome transitions.
- `SAVE-001`, `SAVE-002` — checkpoint, full rollback, no duplicate reward и GM-only audit.
- `GM-001`, `GM-002`, `GM-003` — explicit GM confirmation, private hint, AI proposal non-authority.
- `VIS-*` rules из visibility matrix — field-level filtering и отсутствие hidden data в errors/snapshots.

## 5. Conflicts и конкретные решения

1. **Schema/API conflict:** `command.schema.json` перечисляет `gm.create_checkpoint` и `gm.pause_scene`, API их перечисляет, но `03-system-contracts.md` не описывает payload/preconditions/events. Решение: `gm.create_checkpoint` добавить в command contract с `{label,reason}`; `gm.pause_scene` не активировать до определения semantics и event. Файлы schema/API/system contracts потребуют синхронизации.
2. **Rollback contract conflict:** API требует `confirmationToken`, system payload его не содержит, а error list содержит `ROLLBACK_CONFIRMATION_REQUIRED`. Решение baseline: token обязателен в `gm.rollback_to_checkpoint` payload; синхронизировать system contract и command schema.
3. **Payload validation gap:** общий `payload: object` допускает произвольные поля и не выражает required/optional fields. Решение: per-command definitions, `additionalProperties:false`, runtime domain validation после schema.
4. **Role/command mismatch:** envelope позволяет `role:"player"` для `gm.*` и `role:"gm"` для `player.*`. Решение: server cross-validation; pure JSON Schema может использовать discriminated branches, но authorization всё равно остаётся server-side.
5. **Actor identity ambiguity:** `actorId` в envelope не определён как user или hero, а player commands требуют ownership конкретного героя. Решение baseline: actorId — authenticated user/device actor; ownership/mapped hero берётся из membership/session, не из payload. Если actorId должен быть heroId, требуется ADR/OPEN_QUESTION.
6. **Revision naming gap:** system uses `sceneRevision`, envelope uses `clientRevision`, API join uses `resumeFromRevision`. Решение: зафиксировать `clientRevision` как client copy of `sceneRevision`; переименовывать wire field нельзя без compatibility plan, но docs/types должны явно это сказать.
7. **`targetCell`/`targetEntityId` optionality gap:** system example показывает оба поля, но COMBAT-003 требует targetId только для non-AOE при нескольких целях. Решение: fields optional at schema level, required conditionally by card template/domain validator.
8. **Accepted timestamp ambiguity:** system `acceptedAt: number`, API example does not define units. Решение: выбрать server epoch milliseconds или ISO consistently; пока это OPEN_QUESTION для public contract.
9. **Pause semantics gap:** command есть, но confirmed Rule ID/vertical slice не задаёт, останавливает ли pause timers/input window/simulation и кто видит состояние. Решение: disabled placeholder до отдельного решения, не придумывать поведение.
10. **Scene transfer gap:** state machine mentions explicit `scene_transfer`, but command enum has no transfer command. Это не нужно для mandatory first-slice command path, но перенос сюжетной сцены после retreat нельзя реализовать через существующий player/GM payload без отдельного command. Оставить `OPEN_QUESTION`/future command, не добавлять молча.

## 6. Open questions

- `OPEN_QUESTION`: является ли `actorId` user/session actor или hero/entity ID на wire level?
- `OPEN_QUESTION`: точная политика revision — строгое равенство для всех commands или допустима проверка только при mutation/в batch?
- `OPEN_QUESTION`: `confirmationToken` rollback одноразовый, TTL и scope campaign/session?
- `OPEN_QUESTION`: нужны ли отдельные schemas для `editedPayload` каждого consequence template и какие поля разрешены?
- `OPEN_QUESTION`: какой максимальный размер `gm.send_hint.text`, `reason` и `label`?
- `OPEN_QUESTION`: единицы `acceptedAt` (`epoch ms`, `epoch seconds` или ISO string)?
- `OPEN_QUESTION`: pause semantics: останавливаются ли server tick, intent timers, stamina regen, input window и reconnect timers?
- `OPEN_QUESTION`: нужен ли отдельный command `gm.scene_transfer` в первом slice или transfer выполняется только как server consequence?
- `OPEN_QUESTION`: следует ли добавлять новые error enum values (`TARGET_REQUIRED`, `TARGET_INVALID`, `CARD_REVISION_STALE`) в публичный schema/API contract сейчас или временно маппить их на существующие коды?
- `OPEN_QUESTION`: должен ли `player.play_card` принимать `targetCell` как cell selection только для AOE/ground effects, или все cell targets должны быть представлены entity/cell union?
- `OPEN_QUESTION`: предусмотрен ли command для входа в melee mode отдельно, или contact/scene simulation единственный переход в melee?

## 7. Acceptance checks

### Schema и envelope

- [ ] Envelope отвергает неизвестный top-level field и неизвестный command.
- [ ] Для каждого перечисленного command существует discriminated payload schema.
- [ ] `player.move` принимает только четыре направления и не принимает x/y.
- [ ] Empty payload commands отвергают любые дополнительные поля.
- [ ] `player.play_card` отвергает `rawDamage`, final result, seed и неизвестные поля.
- [ ] Role/command mismatch не проходит authorization.
- [ ] `clientRevision` integer `>=0`; invalid date-time в `clientSentAt` отклоняется.

### Simulation и security

- [ ] stale command не меняет state и не создаёт event.
- [ ] повторный requestId возвращает прежний result и не дублирует event/reward.
- [ ] конфликтующий повтор requestId не исполняется.
- [ ] player не может играть чужой cardInstanceId или двигать чужого героя.
- [ ] player command не может вызвать GM state mutation.
- [ ] move server вычисляет destination; клиент не задаёт позицию.
- [ ] карта проверяет hand/defense container, mode, card revision, stamina, target, range и LoS на сервере.
- [ ] cost 0 проходит при stamina 0; positive cost при недостатке stamina отклоняется.
- [ ] retreat из melee применяет MOVE-004/COMBAT-006, а не client-provided result.
- [ ] end outcome идемпотентен и не дублирует reward/city-save.
- [ ] rollback требует confirmation, полностью восстанавливает snapshot и сохраняет audit.

### Visibility

- [ ] Rejected player command не раскрывает exact hidden target, draw pile, intent formula, seed или GM reason.
- [ ] schema error не отражает неизвестные hidden input fields в safeMessage.
- [ ] private hint доставляется только target player и GM.
- [ ] rollback player notification не раскрывает checkpoint id/source/audit reason.
- [ ] command result/event projection фильтруется до сериализации для TV/player/GM.
- [ ] одинаковый seed и одинаковые accepted commands воспроизводят одинаковый result.

### Вертикальный срез

- [ ] Проходят шаги movement → intent → battle mode → card → status → outcome → checkpoint/rollback.
- [ ] Вход до боя не выдаёт обычную руку карт; `enter_*` меняет только разрешённый mode.
- [ ] Reference/debug party из 3 героев и production acceptance из 4 players используют одинаковый command contract.
- [ ] GM создаёт `city-before-quarantine-01` через checkpoint command до входа в узел.
- [ ] `gm.end_expedition` поддерживает success/retreat/defeat/gm_abort с соответствующими state-machine checks.

## 8. Файлы, которые придётся изменить

Этот review сам изменил только отчёт. Для реализации предложенного контракта потребуются следующие изменения:

1. `/home/ubuntu/lilovaya-gar/packages/contracts/command.schema.json` — добавить per-command payload definitions, strict additional properties, rollback token и create/pause payloads.
2. `/home/ubuntu/lilovaya-gar/packages/contracts/event.schema.json` — при появлении pause/checkpoint/command-specific event payloads уточнить event payload definitions и visibility annotations; envelope уже содержит базовые поля.
3. `/home/ubuntu/lilovaya-gar/packages/contracts/visibility.schema.json` — вероятно расширить только если появятся новые поля/annotations; существующая enum-модель достаточна для описанных payload/event fields.
4. `/home/ubuntu/lilovaya-gar/docs/03-system-contracts.md` — синхронизировать command matrix, rollback token, create checkpoint, pause status, error codes и command-specific preconditions.
5. `/home/ubuntu/lilovaya-gar/docs/08-api-specification.md` — описать payload schemas, cross-role validation, acceptedAt semantics и rollback token на WebSocket/HTTP границе.
6. `/home/ubuntu/lilovaya-gar/docs/04-visibility-matrix.md` — добавить annotations для новых error/result/payload fields, если они сериализуются в projections.
7. `/home/ubuntu/lilovaya-gar/docs/05-vertical-slice.md` — добавить acceptance steps для create checkpoint и уточнить, что pause/scene transfer не входят либо имеют утверждённый flow.
8. `/home/ubuntu/lilovaya-gar/docs/09-database-schema.md` — только если в persistence вводятся payload schema version, confirmation token audit или command-specific result fields; destructive migration не делать без ADR.
9. Runtime TypeScript command types/validators и server authorization module — фактическая реализация discriminated union, ownership, idempotency, revision и safe errors.
10. Unit/integration/replay/visibility/e2e tests — по одному набору на command, duplicate/stale, role mismatch, rollback reward idempotency и leakage negatives.

`docs/00-product-constitution.md`, `docs/01-glossary.md`, `docs/02-confirmed-rules.md` менять не требуется: предложенный контракт реализует их без изменения gameplay semantics. Если будет принято любое решение из OPEN_QUESTION, сначала нужен task-level decision/ADR и соответствующие Rule ID либо явная отметка статуса.
