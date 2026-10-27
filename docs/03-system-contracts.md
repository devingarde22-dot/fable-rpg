# Fable — System Contracts

> **Step B baseline precedence:** wire-level decisions in [04-step-b-baseline.md](./04-step-b-baseline.md) supersede older generic payload examples in this document. Use the typed JSON Schemas under `../packages/contracts/`.

**Версия:** 0.1  
**Статус:** CONFIRMED / IMPLEMENTATION BASELINE  
**Назначение:** технический контракт между TV, Player, GM, server simulation, persistence и AI.

## 1. Архитектурные правила

1. Server simulation — единственный авторитет правил.
2. Клиенты отправляют commands, но не события и не конечные значения.
3. Любое принятое изменение создаёт event.
4. Каждый command идемпотентен по `requestId`.
5. Каждый state mutation проверяет `sceneRevision`.
6. Все случайные результаты получают и записывают server seed.
7. Каждая projection фильтруется на сервере до сериализации.
8. AI proposals не являются событиями и не меняют state.

## 2. Общий envelope

### CommandEnvelope

```ts
type CommandEnvelope<T> = {
  requestId: string;
  sessionId: string;
  actorId: string;
  role: "player" | "gm";
  command: string;
  payload: T;
  clientRevision: number;
  clientSentAt?: string;
};
```

Сервер добавляет `serverReceiveSequence`, `serverReceivedAt`, authorization result и batch id. Клиент не может прислать свой server sequence.

### EventEnvelope

```ts
type EventEnvelope<T> = {
  eventId: string;
  eventType: string;
  eventVersion: number;
  sceneId: string;
  sceneRevision: number;
  serverTick: number;
  serverSequence: number;
  seed?: string;
  causedByRequestId?: string;
  actorId?: string;
  payload: T;
};
```

### CommandResult

```ts
type CommandResult =
  | { ok: true; requestId: string; acceptedAt: number; eventIds: string[]; sceneRevision: number }
  | { ok: false; requestId: string; code: ErrorCode; sceneRevision: number; safeMessage: string };
```

`safeMessage` никогда не раскрывает GM-only причину, скрытую цель, seed или чужую карту.

## 3. Команды первого vertical slice

### `player.move`

```json
{
  "direction": "up|down|left|right"
}
```

Проверки: actor принадлежит player session, режим разрешает движение, клетка в пределах поля, клетка свободна, нет lock состояния, command revision актуальна. Успех создаёт `scene.entity_moved`.

### `player.play_card`

```json
{
  "cardInstanceId": "card-instance-123",
  "targetEntityId": "enemy-2",
  "targetCell": { "x": 7, "y": 3 },
  "mode": "melee|ranged|movement",
  "clientCardRevision": 4
}
```

Проверки: карта находится в разрешённом контейнере, режим совпадает, стоимость стамины доступна, цель и LoS допустимы, состояние героя разрешает действие, карта не просрочена.

### `player.enter_ranged_mode`

Переход доступен только если authoritative `hero.canEnterRangedMode === true`; поле участвует в runtime state, snapshot, state hash и replay. Карты не применяются автоматически; сервер выдаёт разрешённый player projection.

### `player.enter_movement_mode`

Не зависит от карты. Если герой в ближнем бою, запускается отступление и бесплатные базовые атаки окружающих врагов по DR-C-003. Контакт после ranged → movement без immunity сразу переводит в melee, без retreat. Если герой не в бою, телефон показывает стрелки.

### `gm.apply_consequence`

```json
{
  "proposalId": "proposal-123",
  "editedPayload": {},
  "reason": "Игроки спасли свидетеля"
}
```

Только GM. Сервер повторно валидирует разрешённые поля, создаёт journal event и обновляет campaign state.

### `gm.send_hint`

```json
{
  "targetPlayerId": "player-2",
  "text": "Проверь клетку за статуей.",
  "vibration": true
}
```

Создаёт private event только для GM и указанного player.

### `gm.end_expedition`

```json
{
  "outcome": "success|retreat|defeat|gm_abort",
  "consequenceId": "consequence-1",
  "createCitySave": true,
  "reason": "..."
}
```

Все outcomes проходят отдельную state machine и idempotency-проверку наград.

### `gm.rollback_to_checkpoint`

```json
{
  "checkpointId": "checkpoint-city-mirevalt-01",
  "reason": "Возврат после технической ошибки"
}
```

Только GM, требует явного confirmation. Создаёт технический audit и новый filtered snapshot.

## 4. События первого vertical slice

```text
scene.created
scene.entity_moved
scene.entity_removed
card.drawn
card.played
card.discarded
stamina.changed
hp.changed
status.applied
status.refreshed
status.expired
mode.changed
intent.started
intent.cancelled
intent.resolved
intent.target_selected
hint.sent
scene.ended
expedition.ended
checkpoint.created
checkpoint.restored
rollback.applied
scene.transferred
```

Каждое событие содержит `eventVersion`, `sceneRevision`, `serverTick`, `serverSequence` и `causedByRequestId`.

Для retreat: accepted command creates one event group and increments `sceneRevision` once; attack/HP events resolve by ascending `enemyId`; emit `hp.changed` only on actual HP change. Contact checks occur after hero movement, enemy movement, scene activation when available, and mode transition. Replay reconstructs mode/HP/immunity/group/hash from events or deterministic tick; see [DR-C-003](./16-step-c-retreat-resolution.md).

New damage is recorded as `hp.changed` v2 with source and `fable.damage.v1` inputs/results; v1 remains replay-compatible. Enemy removal uses `scene.entity_removed` after HP reaches 0 and cleanup runs. If its active intent exists, order is `hp.changed` → `intent.cancelled(owner_removed)` → `scene.entity_removed`. Events from one damage batch share one `sceneRevision` and `eventGroupId`; formula/source details are GM/audit-only.
## 5. Детерминированный scheduler

```text
receive command
→ authenticate role
→ check requestId idempotency
→ check sceneRevision
→ add to current 250 ms input window
→ close window
→ sort players → enemies → environment
→ reserve cells and targets
→ validate against current batch state
→ apply rules in simulation
→ emit events in sequence
→ increment sceneRevision
→ build filtered projections
→ persist journal/checkpoint if required
→ broadcast
```

Simulation baseline: 20 Hz. Два действия внутри одной группы сортируются по server receive sequence и actorId. Результат random target или tie-break вычисляется из seed, сохранённого в event.

## 6. State machines

### Hero mode

```text
OUT_OF_COMBAT
  ├─ enemy_contact → MELEE_COMBAT
  ├─ ranged_card_available + player command → RANGED_COMBAT
  └─ player command → MOVEMENT

MOVEMENT
  ├─ free cell + move command → MOVEMENT
  ├─ ranged command + allowed cards → RANGED_COMBAT
  ├─ contact after 15s immunity → MELEE_COMBAT
  └─ scene end → OUT_OF_COMBAT

MELEE_COMBAT
  ├─ play allowed card → MELEE_COMBAT
  ├─ movement command → RETREAT_RESOLUTION → MOVEMENT
  └─ scene end → OUT_OF_COMBAT

RANGED_COMBAT
  ├─ play allowed card → RANGED_COMBAT
  ├─ movement command → MOVEMENT
  ├─ contact → MELEE_COMBAT
  └─ scene end → OUT_OF_COMBAT
```

### Intent

```text
IDLE
→ STARTED
→ TELEGRAPHED
→ RESOLVING
→ RESOLVED
→ NEXT_INTENT

TELEGRAPHED
→ CANCELLED(reason)
→ FILTER_POOL
→ NEXT_INTENT
```

### Expedition outcome

```text
ACTIVE
├─ gm end success → COMPLETED + city checkpoint
├─ retreat → CLOSED_RETREAT + reward locked
├─ defeat → CLOSED_DEFEAT + return + retry policy
└─ gm_abort → CLOSED_GM_ABORT + explicit checkpoint

CLOSED_* → rollback checkpoint → RESTORED
```

`scene_transfer` переносит только явно разрешённую незавершённую сцену. Он не открывает награду закрытого узла автоматически.

## 7. Visibility contract

### TV получает

- публичные клетки и препятствия;
- публичные позиции сущностей;
- HP, если сцена разрешает публичный HP;
- icon текущего intent;
- красную клетку/область дальней атаки;
- публичные статусы и VFX;
- публичные scene events.

### Player получает

- состояние собственного героя;
- свою руку из 5 карт;
- слот защиты;
- свою стамину и HP;
- доступные цели;
- разрешённые карты и режим;
- private hints от GM;
- только ту информацию о врагах, которую выдаёт public telegraph.

### GM получает

- полный server projection;
- скрытые цели и формулы;
- все руки и discard;
- seed;
- audit;
- GM-only lore;
- proposals и редакторы.

### AI получает

Только выбранный context packet и разрешённые поля текущей кампании. AI prompt не может получить лишние руки, скрытые поля другой роли или API credentials.

## 8. Error codes

```text
AUTH_FORBIDDEN
STALE_SCENE_REVISION
DUPLICATE_REQUEST
INVALID_MODE
CELL_BLOCKED
TARGET_NOT_VISIBLE
TARGET_OUT_OF_RANGE
LINE_OF_SIGHT_BLOCKED
CARD_NOT_AVAILABLE
INSUFFICIENT_STAMINA
STATE_LOCKED
INTENT_EXPIRED
NODE_NOT_DISCOVERED
OUTCOME_ALREADY_APPLIED
CHECKPOINT_NOT_FOUND
ROLLBACK_CONFIRMATION_REQUIRED
SCHEMA_INVALID
```

Ошибки должны быть безопасными: подробная причина доступна GM и audit, игрок получает только необходимое объяснение.

## 9. Persistence minimum

- `campaigns`
- `scenes`
- `scene_entities`
- `event_journal`
- `checkpoints`
- `commands_idempotency`
- `content_versions`
- `gm_hints`
- `visibility_audit`

Event journal — append-only. Checkpoint хранит snapshot version, event sequence, seed state и campaign revision.

## 10. Acceptance for contracts

Контракты готовы, если:

1. stale command не меняет state;
2. повторный requestId не дублирует событие;
3. игрок не получает GM-only поле ни в snapshot, ни в error;
4. два клиента при одинаковом seed получают одинаковый результат;
5. rollback восстанавливает state и не выдаёт награду дважды;
6. reconnect получает актуальный filtered snapshot;
7. каждая команда vertical slice имеет unit и integration test.
