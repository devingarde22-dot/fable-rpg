# Fable — Step C: Core Engine & State Machine

**Версия:** 0.1
**Статус:** BASELINE / IMPLEMENTATION-READY FOR HEADLESS CORE
**Дата:** 2026-10-27
**Scope:** headless simulation engine для первого vertical slice `Quarantine Gates`.

> Этот документ определяет серверную логику симуляции. Он не описывает React, Colyseus room, PostgreSQL или AI Copilot. Эти слои подключаются после того, как headless engine проходит acceptance tests. Wire-контракты из [`04-step-b-baseline.md`](./04-step-b-baseline.md) имеют приоритет при расхождении.

---

## 1. Цель Step C

Step C превращает подтверждённые правила в детерминированное ядро, которое можно запускать без сети, браузера и базы данных. На вход engine получает команды и фиксированный seed; на выходе — новый authoritative state и упорядоченный список domain events.

Минимальный сценарий должен уметь:

1. создать сцену 9×9;
2. зарегистрировать героев, врагов, препятствия и шаблоны карт;
3. принимать `player.move` в real-time loop;
4. обрабатывать input windows по 250 мс при частоте 20 Hz;
5. перемещать игроков и врагов без пересечения клеток;
6. вводить героя в movement, ranged или melee mode;
7. запускать и разрешать enemy intents;
8. раздавать карты при входе в бой;
9. разыгрывать карту с проверкой стоимости, дальности, LoS, цели и статусов;
10. изменять HP, stamina и status layers;
11. записывать все изменения в in-memory event journal;
12. воспроизводить тот же результат из event sequence и seed.

### Out of scope

В Step C не входят transport, авторизация, persistence, визуальные анимации, production content editor и AI. Engine должен быть изолирован от них через интерфейсы `CommandSource`, `EventSink` и `Clock`.

---

## 2. Нормативные принципы

### C-001 — один authoritative state

Только `SimulationEngine` имеет право менять runtime state. Клиенты, room adapter и AI не изменяют сущности напрямую. Они подают commands или читают projections.

### C-002 — command не является результатом

Команда содержит намерение: направление, карту, режим или цель. Она не может содержать `rawDamage`, `finalDamage`, `hit`, `critical`, `seed`, `destination`, `newHp`, `newStamina` или другой вычисленный результат.

### C-003 — command-level atomicity inside an ordered batch

Одна закрытая input window обрабатывается как детерминированный batch в порядке players → enemies → environment. Каждая команда валидируется и применяется атомарно: если команда отклонена, вызванная именно ею gameplay mutation не происходит, domain event не создаётся и `sceneRevision` не увеличивается. Уже принятые ранее команды того же batch не откатываются из-за последующего reject; например, при конкуренции за одну клетку команда-победитель применяется, остальные конфликтующие команды отклоняются. Если batch содержит одну или более принятых gameplay mutations, они входят в один event group и увеличивают `sceneRevision` ровно один раз.

Authoritative `serverTick` и scheduler/input-window bookkeeping продолжают продвигаться независимо от результата команды. Их изменение при закрытии окна не считается gameplay mutation, вызванной отклонённой командой.

### C-004 — deterministic replay

При одинаковых `initialSnapshot`, `rulesetVersion`, `contentVersion`, command sequence и `rootSeed` engine создаёт идентичные state hash и event payloads. Wall-clock time, `Math.random()` и порядок обхода неупорядоченных коллекций запрещены.

### C-005 — server ticks, not wall clock

`TICK_RATE = 20`; один tick равен 50 ms. Все timers хранятся в ticks. `remainingMs` вычисляется только как transport hint: `max(0, (resolvesAtTick - serverTick) * 50)`.

### C-006 — event after mutation

Сначала rule handler вычисляет и применяет валидную mutation к working state, затем создаёт event с `before`/`after`-значениями, где это разрешено. Event никогда не является инструкцией для engine применить мутацию повторно.

### C-007 — closed transitions

Неизвестный mode, intent state, scene phase, status stack policy или command type даёт безопасный отказ `INVALID_STATE`/`SCHEMA_INVALID`, а не implicit fallback.

---

## 3. Слои Core Engine

```text
SimulationEngine
├── TickClock              // authoritative serverTick
├── CommandInbox           // accepted commands for current window
├── WindowScheduler        // close, sort, reserve, validate
├── RuleSystem             // pure gameplay calculations
├── EntityRegistry         // runtime entities by opaque id
├── CollisionSystem        // cells, occupancy, LoS, range
├── ModeSystem             // hero mode transitions
├── CombatSystem           // cards, targets, damage, effects
├── IntentSystem           // enemy telegraphs and resolutions
├── ResourceSystem         // HP, stamina, regeneration
├── StatusSystem           // layers, expiry, modifiers
├── OutcomeSystem          // scene/expedition closure
├── Journal                // append-only in-memory events
└── DeterministicRng      // named, seed-derived streams
```

Каждый system получает ограниченный typed context и возвращает `MutationPlan`. Только engine применяет plan. Это не позволяет, например, `CombatSystem` самостоятельно удалить сущность из registry.

### Рекомендуемые интерфейсы

```ts
export interface SimulationEngine {
  readonly state: RuntimeState;
  submit(command: InternalCommand): SubmitResult;
  advanceOneTick(): TickResult;
  advanceTicks(count: number): TickResult[];
  snapshot(): RuntimeSnapshot;
  replay(events: readonly DomainEvent[]): RuntimeSnapshot;
}

export interface RuleSystem {
  evaluate(context: RuleContext): MutationPlan | RuleRejection;
}

export interface DeterministicRng {
  fork(label: string): DeterministicRng;
  nextInt(minInclusive: number, maxInclusive: number): number;
  nextFloat(): number;
  stateHash(): string;
}
```

---

## 4. Runtime state model

Runtime state не равен DB row и не равен filtered projection. Это внутренний объект simulation package.

```ts
export type RuntimeState = {
  campaignId: string;
  sessionId: string;
  scene: SceneRuntime;
  entities: Map<EntityId, EntityRuntime>;
  templates: ContentCatalog;
  serverTick: number;
  sceneRevision: number;
  nextServerSequence: number;
  rootSeed: string;
  rngState: string;
  phase: ScenePhase;
  paused: boolean;
  outcome: ExpeditionOutcome | null;
};

export type SceneRuntime = {
  id: string;
  templateKey: string;
  width: 9;
  height: 9;
  cells: CellRuntime[];
  playerEntityIds: EntityId[];
  enemyEntityIds: EntityId[];
  activeIntentIds: string[];
  inputWindow: InputWindowRuntime;
  startedAtTick: number;
  contactImmunityUntilTick: Map<EntityId, number>;
};
```

### 4.1 CellRuntime

```ts
export type CellRuntime = {
  x: number;
  y: number;
  terrain: "floor" | "wall" | "statue" | "start_player" | "start_enemy";
  blocksMovement: boolean;
  blocksLineOfSight: boolean;
  occupantId: EntityId | null;
};
```

Нормативные правила:

- координаты начинаются с `(0, 0)`;
- `x` увеличивается вправо, `y` увеличивается вниз;
- одна клетка равна 1 метру;
- wall блокирует movement и LoS;
- statue/barrier блокирует movement и LoS для атаки через объект, но не скрывает видимую сущность в projection;
- союзник блокирует movement, но не LoS projectile;
- враг блокирует movement и не может быть пересечён;
- diagonal соседство является melee contact, но движение в Step C остаётся четырёхнаправленным.

### 4.2 EntityRuntime

```ts
export type EntityRuntime = {
  id: EntityId;
  canEnterRangedMode?: boolean; // required on HeroRuntime; authoritative and included in snapshot/hash/replay
  kind: "hero" | "enemy" | "npc" | "summon";
  templateKey: string;
  faction: "party" | "enemy" | "neutral";
  position: Cell;
  aliveState: "active" | "unconscious" | "critically_injured" | "removed";
  hp: ResourceValue;
  stamina: StaminaRuntime;
  stats: StatsRuntime;
  mode: HeroMode | null;
  deck: DeckRuntime | null;
  statuses: StatusLayer[];
  activeIntentId: string | null;
  threat: ThreatRuntime;
  control: ControlRuntime;
};

export type ResourceValue = { current: number; max: number };
export type StaminaRuntime = {
  current: number;
  max: number;
  nextRegenAtTick: number | null;
};
```

Для enemies `mode` и `deck` равны `null`; враг использует `activeIntentId`. Hero status `critically_injured` не удаляет entity из поля в рамках первого slice.

### 4.3 DeckRuntime

```ts
export type DeckRuntime = {
  drawPile: CardInstance[];
  hand: CardInstance[];         // максимум 5
  discard: CardInstance[];
  excludedForMode: CardInstance[]; // карта другого режима не теряется
  defenseSlot: CardInstance | null; // ровно один отдельный слот на героя
  revision: number;
  nextHandRotationAtTick: number | null;
};
```

Каждый instance находится ровно в одном из пяти контейнеров: `drawPile`, `hand`, `defenseSlot`, `discard` или `excludedForMode`. `defenseSlot` — отдельное поле с не более чем одной картой защиты на героя; он не входит в лимит обычной руки. В Increment 7 при каждом входе/переключении в `melee` или `ranged` server собирает eligible instances, фильтрует по `allowedModes`, детерминированно перемешивает пул и выдаёт до пяти обычных карт; не подходящие для текущего режима идут в `excludedForMode`. Increment 10 добавляет test-only defense cards/slot, но не production card catalog; scope — [DR-C-010](./25-step-c-increment-10-full-headless-slice.md). Успешный play переносит карту из hand или defense slot в `discard` без немедленного добора. Канонические правила ротации, empty piles, RNG и replay заданы [DR-C-007](./21-step-c-deck-cycle.md).

---

## 5. Состояния сцены и глобальные инварианты

```ts
export type ScenePhase =
  | "loading"
  | "active"
  | "resolving_outcome"
  | "ended";
```

### Разрешённые переходы

```text
loading → active
active → resolving_outcome       (GM outcome или slice victory condition)
resolving_outcome → ended        (outcome committed)
ended → ended                    (только idempotent reads)
```

`paused` — orthogonal flag для `active`; pause не меняет `phase` и не создаёт combat transition.

### Инварианты, проверяемые после каждого batch

1. `0 <= serverTick` и `sceneRevision >= 0`.
2. Все entity IDs уникальны и ссылаются на существующие template keys.
3. В одной cell не более одного `occupantId`.
4. Каждая активная entity имеет ровно одну позицию внутри grid.
5. `0 <= hp.current <= hp.max`; `0 <= stamina.current <= stamina.max`.
6. Все deck card instance IDs уникальны между `drawPile`, `hand`, `defenseSlot`, `discard` и `excludedForMode`; один instance не занимает два контейнера.
7. Hero hand содержит максимум 5 карт; defense slot содержит только `cardType=defense`.
8. Каждый active intent ссылается на одного существующего enemy.
9. `resolvesAtTick >= startedAtTick`.
10. Expired statuses и intents не остаются active после cleanup phase.
11. Ended scene не принимает gameplay commands.
12. Каждая journal запись имеет строго возрастающий `serverSequence`.

Нарушение инварианта — fatal engine error в development и controlled scene lock в production; engine не продолжает с повреждённым state.

---

## 6. Tick loop и фазы одного tick

`advanceOneTick()` выполняет следующие фазы в фиксированном порядке.

```text
0. CLOCK
1. INGEST
2. WINDOW_CLOSE
3. PLAYER_ACTIONS
4. INTENT_RESOLUTION
5. ENVIRONMENT
6. RESOURCE_REGEN
7. STATUS_AND_TIMER_CLEANUP
8. POST_BATCH
9. INVARIANT_CHECK
10. EMIT / SNAPSHOT MARK
```

### 6.1 CLOCK

Если scene paused или phase не `active`, `serverTick` не увеличивается и gameplay phases не выполняются. Разрешены только GM pause/resume, reads и rollback на transport layer.

Иначе `serverTick += 1`. Input window идентифицируется как:

```ts
const INPUT_WINDOW_TICKS = 5; // 250 ms at 20 Hz
const windowId = Math.floor(serverTick / INPUT_WINDOW_TICKS);
```

`clientRevision` обязателен как transport metadata, но не сравнивается с глобальной `sceneRevision` для player-команд. Команда попадает только в текущую input window и не переносится молча в следующую.

### 6.2 INGEST

Transport adapter передаёт уже schema-validated `InternalCommand` с server receive sequence. Engine:

- выполняет idempotency lookup по `(sessionId, actorId, requestId)`; повтор этой тройки возвращает сохранённый результат, а одинаковый `requestId` у другого actor/session независим;
- проверяет фазу сцены, роль/session и ownership actor → hero;
- отклоняет команды завершённой сцены и неподходящих actors;
- не отклоняет player-команду только из-за старого `clientRevision`; legality повторно проверяется по live state при apply-time;
- помещает валидную command в текущую inbox;
- сохраняет receive sequence, session id, actor id и request id как input-window journal metadata (не как domain event).

В headless тесте внешняя authentication заменена trusted fixture identity; engine всё равно проверяет session/role и server-resolved ownership. Структурная проверка команды повторяется внутри engine.

### 6.3 WINDOW_CLOSE

На каждом authoritative tick фазы выполняются в фиксированном порядке. Player commands обрабатываются только при закрытии их пяти-tick input window; due enemy intents проверяются на каждом tick. Поэтому на window-close tick сначала применяются player commands, затем due enemy intents, затем environment:

```text
1. player commands
2. enemy intent resolutions
3. environment effects
```

Внутри одной группы:

```text
serverReceiveSequence ASC
actorId ASC
requestId ASC
```

`requestId` нужен только как последний стабильный tie-break. Client timestamp не участвует.

### 6.4 PLAYER_ACTIONS

При закрытии окна каждая queued player command заново проверяется против live state, до любой gameplay-мутации:

1. герой всё ещё принадлежит actor и активен;
2. mode, statuses, target и таймер всё ещё допускают действие;
3. текущие card/hand revision, card availability, режим карты и ресурсы валидны;
4. клетки, target, дальность, line of sight и batch reservations валидны;
5. mutation plan применяется атомарно и создаёт domain events только при принятой мутации.

Если действие стало невозможным из-за более раннего действия batch, оно получает rejection `CONFLICTING_BATCH_STATE` и не откатывает уже committed actions. Для команды, состоящей из нескольких внутренних эффектов, mutation атомарна целиком.

### 6.5 INTENT_RESOLUTION

На каждом tick каждый enemy с intent, достигшим `resolvesAtTick`, разрешается не более одного раза. На окне закрытия это происходит после player actions; между закрытиями — после пустой player phase. Intent resolution проверяет актуальные клетки, LoS, target validity и statuses. Невыполнимый intent не наносит частичный эффект: он создаёт `intent.cancelled` с причиной и проверяет ordered fallback согласно DR-C-002.

### 6.6 ENVIRONMENT

В первом slice environment phase ограничена:

- expiry/reaction effects, разрешённые правилами;
- уничтожение removed entities;
- future support for hazards, но не произвольный scripting.

### 6.7 RESOURCE_REGEN

Stamina regen использует только authoritative ticks: 1 единица каждые 300 ticks (15 секунд). Новый hero начинает с 3 stamina; `max` задаётся config/preset и должен быть не меньше 3. Если `current < max` и герой активен, первый due tick равен `initialServerTick + 300`.

На due tick активный герой получает ровно 1 единицу. Если он всё ещё ниже максимума, следующий due tick сдвигается на 300 ticks. При достижении max timer становится `null`: полный запас не накапливает восстановления. Будущее успешное списание должно запускать новый полный интервал от tick списания, а не выдавать catch-up. Регенерация не выполняется при `aliveState !== "active"`; HP=0/`critically_injured` останавливает timer. Movement, melee и ranged mode не блокируют regen.

Ресурсная фаза запускается после players, enemies и environment и до cleanup; heroes обрабатываются по `heroId`. Каждое реальное восстановление выдаёт `stamina.changed`; timer и current входят в replay и `stateHash`. Scene pause engine support не входит в Increment 5; pause contracts остаются будущей отдельной задачей.

### 6.8 CLEANUP

В фиксированном порядке:

1. удалить due status layers по `entityId`, затем `layerId`; emit `status.expired` once per layer;
2. завершить immobilized/unconscious timers;
3. очистить resolved/cancelled intents;
4. применить mode transitions, отложенные до конца resolution;
5. выдать next intents;
6. обновить timer render hints.

### 6.9 POST_BATCH

Если хотя бы одна authoritative mutation была применена:

- `sceneRevision += 1` ровно один раз для всей batch;
- всем batch events присваивается одинаковая post-commit revision;
- `eventIndex` задаёт порядок внутри batch;
- state hash пересчитывается;
- journal append выполняется до broadcast adapter.

---

## 7. Command lifecycle

```text
raw transport message
→ schema validation
→ normalize envelope
→ authenticate actor
→ idempotency lookup
→ scene membership / ownership
→ ended-scene guard
→ input-window queue
→ deterministic ordering
→ apply-time legality recheck against live state
→ mutation plan
→ apply atomically
→ domain events
→ revision increment
→ filtered projection
```

Idempotency key — `(sessionId, actorId, requestId)`, согласованный с B-001: `actorId` — authenticated session actor, а не выбранный клиентом hero ID. Повтор той же тройки возвращает сохранённый первоначальный/финальный результат и не добавляет игровые события; одинаковая строка `requestId` у другого actor или session не является duplicate.

### Rejection rules

Rejection при admission или apply-time не вызывает gameplay-state mutation, не записывает domain event и не увеличивает revision. Authoritative `serverTick` и scheduler bookkeeping могут продвигаться независимо от reject. `appendInputWindow` может хранить принятую в очередь команду как `input_window` record для воспроизведения scheduler; это отдельный journal-record kind, не событие. Transport возвращает command result, но `command.rejected` не является domain event.

Минимальные Step C errors:

```text
SCHEMA_INVALID
AUTH_FORBIDDEN
STALE_SCENE_REVISION
STALE_CARD_REVISION
DUPLICATE_REQUEST
STATE_LOCKED
INVALID_MODE
CELL_OUT_OF_BOUNDS
CELL_BLOCKED
CELL_OCCUPIED
TARGET_NOT_VISIBLE
TARGET_OUT_OF_RANGE
LINE_OF_SIGHT_BLOCKED
CARD_NOT_AVAILABLE
CARD_MODE_MISMATCH
INSUFFICIENT_STAMINA
ENTITY_UNABLE_TO_ACT
INTENT_EXPIRED
CONFLICTING_BATCH_STATE
INVALID_STATE
```

`STALE_SCENE_REVISION` сохранён в error-code union для будущих операций со строгой global-revision проверкой, включая возможные GM/server-команды. В текущих player `move`, mode и `play_card` call paths runtime не возвращает этот код; карта при применении проверяет отдельный `clientCardRevision`.

---

## 8. Hero mode state machine

```text
OUT_OF_COMBAT
├─ player.enter_movement_mode → MOVEMENT
├─ player.enter_ranged_mode + hero.canEnterRangedMode === true → RANGED_COMBAT
└─ contact with enemy → MELEE_COMBAT

MOVEMENT
├─ player.move + free cell → MOVEMENT; then contact check
├─ contact + immunity expired → MELEE_COMBAT
├─ player.enter_ranged_mode + hero.canEnterRangedMode === true → RANGED_COMBAT
└─ scene end → OUT_OF_COMBAT

RANGED_COMBAT
├─ `CardTemplate.allowedModes` contains `ranged` → eligible current card play
├─ player.enter_movement_mode → MOVEMENT; then contact check
├─ contact → MELEE_COMBAT (no immunity and no retreat)
└─ scene end → OUT_OF_COMBAT

MELEE_COMBAT
├─ `CardTemplate.allowedModes` contains `melee` → eligible current card play
├─ no magic/category modifier in the current Step C runtime
├─ player.enter_movement_mode → RETREAT_RESOLUTION → MOVEMENT
└─ scene end → OUT_OF_COMBAT
```

### Контакт и contact immunity
Melee contact — любая из 8 соседних клеток вокруг enemy. Проверка контакта выполняется после перемещения героя, перемещения врага, активации сцены (если доступно) и перехода режима. После melee retreat герой получает `contactImmunityUntilTick = currentTick + 300`; immunity активно, пока `serverTick < contactImmunityUntilTick`. Контакт не переводит героя в melee во время immunity. При контакте после перехода ranged → movement immunity не предоставляется: немедленный переход в melee, без retreat resolution.
### Retreat resolution (DR-C-003)
Только при переходе `MELEE_COMBAT → MOVEMENT` engine определяет окружающих врагов в melee contact, сортирует их строго по `enemyId` ascending (без RNG) и разрешает по одной immediate basic attack каждому. Для attack number `i` в этом порядке (1-based) коэффициент равен `1 / i`; он применяется только к retreat attacks. Формула: `mitigation = 100 / (100 + heroDefense)`, `mitigatedDamage = ceil(rawDamage * mitigation)`, `finalDamage = ceil(mitigatedDamage * coefficient)`; HP floors at 0. Нет crit, miss, status или stun. Продолжить все eligible атаки, даже если HP достигло 0; установить `critically_injured`. Emit `hp.changed` только если HP реально изменилось. Установить immunity в `currentTick + 300` до `mode.changed(reason: retreat)`. Accepted retreat command формирует одну event group и увеличивает `sceneRevision` ровно один раз; атаки и их HP events идут по `enemyId` ascending. Same-tick enemy intents продолжаются обычно с обычными preconditions; их не отменять и не перезапускать.
---
## 9. Movement и collision

### `player.move`

Команда содержит только `direction`. Engine вычисляет destination из authoritative position.

Validation:

- actor владеет ровно одним hero;
- hero mode допускает movement;
- hero не unconscious/critically injured/immobilized;
- direction — `up|down|left|right`;
- destination внутри grid;
- destination не wall/statue;
- destination не занята hero, enemy или blocking NPC;
- команда не нарушает retreat immunity rules.

При успехе:

```text
scene.entity_moved
payload: { entityId, from, to, movementKind: "player" }
```

Сначала резервируются все destinations batch. Это запрещает двум игрокам одновременно занять одну клетку независимо от обхода map.

### Enemy pathing

Первый slice использует deterministic greedy pathing:

1. Manhattan distance to selected target;
2. candidate directions in fixed order `up, left, right, down`;
3. discard blocked/occupied destinations;
4. choose candidate reducing distance;
5. tie-break by enemy id only if multiple enemies select same route.

A* не требуется в Step C. Если greedy path не существует, `move_close` считается невозможным и intent заменяется.

---

## 10. Intent system

### ActiveIntent

Подробное подтверждённое решение для Enemy Registry + Deterministic Intent Simulation зафиксировано в [DR-C-002](./15-step-c-intent-simulation.md). Для intent template единственный wire source of truth — `packages/contracts/intent.schema.json`.

```ts
export type ActiveIntent = {
  activeIntentId: string;
  ownerEntityId: EntityId;
  templateKey: string;
  state: "started" | "telegraphed" | "resolving" | "resolved" | "cancelled";
  startedAtTick: number;
  resolvesAtTick: number;
  targetEntityId: EntityId | null;
  targetCell: Cell | null;
  publicTargetCell: Cell | null;
  selectionPolicy: TargetPolicy;
  seedRef: string | null;
  cancelReason: IntentCancelReason | null;
};
```

### Lifecycle

```text
IDLE
→ STARTED
→ TELEGRAPHED
→ RESOLVING
→ RESOLVED
→ NEXT_INTENT

TELEGRAPHED
→ CANCELLED(reason)
→ NEXT_INTENT
```

Wire template использует `durationMs`, `conditions`, `targetRules`, `effect` и `fallbackKeys` согласно `intent.schema.json`. Runtime derives `durationTicks = durationMs / 50`; валидная длительность не меньше 3000 ms и делится на 50 без остатка. Не добавлять параллельные wire fields `durationTicks`, `requiresLineOfSight`, `targetPolicy` или `range`.

### Target selection

1. Отфильтровать entities по faction, alive state, range, LoS и status rules.
2. Применить указанную `targetRules.policy` и последовательно проверить `fallbackPolicies`.
3. Если несколько targets имеют одинаковый лучший rank, выбрать через forked `target_selection` RNG; unique candidate не требует random draw.
4. Записать exact target, policy, tie-break mode и `seedRef` в GM/audit event; TV/Player получают target cell только при явном разрешении visibility/reveal policy.

### Impossible intent

Intent считается impossible, если после проверки текущего authoritative state не выполняются target, path, range, LoS или effect preconditions. Impossible intent не применяет частичный gameplay mutation. Resolution:

```text
intent.cancelled(reason)
→ try fallbackKeys in declared order, then hold_position only if allowed by the enemy template
→ intent.started for the first valid, supported fallback (if any)
```

Если валидного fallback нет, emit terminal `intent.cancelled(no_valid_fallback)`, оставить enemy без active intent и не повторять impossible intent в том же tick. `reposition` — deferred/draft, не активный handler и не fallback. Подробности порядка проверки и fallback — в DR-C-002.

### Первый registry

| Enemy | Registered content | Active runtime handlers in this increment |
|---|---|---|
| `quarantine_chaser` | `move_close`, `melee_strike`, `hold_position` | `move_close`, `melee_strike`, `hold_position` |
| `slag_shooter` | `ranged_shot`, `reposition` (draft/deferred), `hold_position` | `ranged_shot`, `hold_position` |
| `extinguisher` | `bind`, `ally_guard`, `move_close` | `bind` and `ally_guard` active; `reposition` remains inactive |

`bind` is an active runtime handler for the bounded `immobilized` effect specified in [DR-C-008](./22-step-c-status-immobilized.md). The existing production `extinguisher` template is active now that both required status handlers are implemented; no catalog values were added or changed. `ally_guard` behavior is specified in [DR-C-009](./23-step-c-ally-guard.md). `reposition` remains deferred and inactive. Enemy-specific timers/effects and RNG/version details are defined in DR-C-002.

---

## 11. Card execution pipeline

`player.play_card` обрабатывается строго так:

```text
locate card instance
→ check hand/defense slot
→ check hero mode and card allowedMode
→ check card not disabled by status
→ check stamina cost
→ resolve target/cell
→ check range and LoS
→ reserve card and target
→ calculate effects from template + runtime stats
→ apply HP/status/resource effects
→ move card to discard
→ emit events
```

### Cost rules

- card cost `0` разрешена при stamina `0`;
- любая positive cost требует `current >= cost`;
- стоимость вычитается только после успешной semantic validation;
- rejected card остаётся в прежнем контейнере;
- карта не исчезает: после play она находится в discard.

### Range/LoS
- 1 клетка = 1 метр;
- Chebyshev distance `max(|dx|, |dy|)` используется для current player-card и enemy-intent range checks; template bounds inclusive;
- diagonal считается melee contact;
- `wall`/`statue` blocking LoS запрещает current ranged action через объект, когда template требует LoS;
- current `player.play_card` поддерживает single-target direct damage и self/ally defense effects; AOE, projectile ally damage, thrown/potion and skill semantics не реализованы;
- current templates не имеют magic/category marker; magic-melee modifier и status-potency rule DEFERRED до отдельного DR.
### Damage formula
```text
mitigation = 100 / (100 + targetDefense)
mitigatedDamage = ceil(rawDamage * mitigation)
finalDamage = ceil(mitigatedDamage * multiplier)
```
Это `fable.damage.v1`. Для current Step C valid action не делает hit/miss/critical roll; отдельные probability, RNG, event и replay semantics отсутствуют и DEFERRED. Formula inputs/results находятся в authoritative/GM event view, а Player projection получает только allowlisted public data.

### Card mode filter
- карта допустима в режиме, когда `allowedModes` содержит текущий `melee` или `ranged`;
- `allowedModes` не определяет product category, magic или universal semantics;
- в movement mode обычная combat card не разыгрывается;
- при смене battle mode текущая hand возвращается в соответствующие deck containers и выдаётся новая разрешённая hand;
- если draw pile текущего режима исчерпан, его discard перемешивается deterministic RNG и становится draw pile;
- cards from another mode не уничтожаются и не считаются lost.

---

## 12. HP, stamina и statuses

### HP outcomes

При `hp.current` равном нулю engine переводит hero в `critically_injured`, а не удаляет его из scene. В первом slice critically injured герой не может действовать. Полная defeat/party outcome решается OutcomeSystem, не HP handler.

Enemy с HP 0 немедленно исключается из целей и разрешения intents, но получает `removed` только после batch cleanup; его occupied cell освобождается только в cleanup phase, не в середине player action ordering. Если enemy имеет active intent, cleanup emits `intent.cancelled(owner_removed)` перед `scene.entity_removed(hp_depleted)`. Контракт и формула описаны в [DR-C-004](./18-step-c-hp-damage-resolution.md).

### Stamina timer

Default:

```text
maxStamina: content preset
initialStamina: 3
regenAmount: 1
regenEveryTicks: 300
```

Engine хранит `nextRegenAtTick`, а projection строит circular timer из remaining ticks. Client не может прислать этот timer.

### StatusLayer

```ts
export type StatusLayer = {
  id: string;
  templateKey: "immobilized" | "ally_guard"; // current implemented status keys; see DR-C-008/009
  sourceEntityId: EntityId | null;
  potency: number;
  stacks: number;
  appliedAtTick: number;
  expiresAtTick: number;
  refreshPolicy: "refresh_duration" | "add_duration" | "diminishing_potency" | "replace";
};
```

Runtime layer shape and creation/clone invariants are specified in [DR-C-008](./22-step-c-status-immobilized.md). The current `StatusTemplateKey` is the closed union `"immobilized" | "ally_guard"`; the shared `StatusRefreshPolicy` type lists future policy values, but only `"refresh_duration"` is enabled for these statuses.

`immobilized` and `ally_guard` last 300 ticks. Refresh preserves layer ID, original source, potency and stacks, then sets `appliedAtTick` to the latest successful application tick and expiry to that tick + 300; it does not add duration or potency. Status cleanup runs after player/enemy/environment/resource/card phases; the status is effective through gameplay resolution on its due tick and is then removed with `status.expired`. This exact boundary is covered by integration tests.

Implemented in this Step C increment:

- `immobilized`: blocks `player.move`; 15 seconds / 300 ticks; only test-backed `bind` applies it.
- `ally_guard`: 20% defense bonus for 15 seconds / 300 ticks; the existing Extinguisher intent applies it to an eligible enemy ally. Damage uses `effectiveDefense = baseDefense * 1.20` without intermediate rounding; base entity defense is unchanged. See [DR-C-009](./23-step-c-ally-guard.md).

Future, not implemented by Increment 8:

- `unconscious`: запрещает любое действие на configured duration;
- `last_chance`: +20% all stats while surrounded, if enabled by ruleset;
- `stamina_overload`: -30% stamina regeneration for 15s after configured powerful card;
- `contact_immunity`: скрытый control timer after retreat.

---

## 13. Event production

Engine создаёт только canonical events из Step B. Минимальный порядок для successful card:

```text
mode.changed                 // если action caused mode entry
card.played
stamina.changed
hp.changed                  // zero or more, one per target
status.applied              // zero or more
card.discarded
```

Для intent:

```text
intent.started
intent.target_selected       // if target policy requires explicit target
intent.resolved
hp.changed v2 / status.applied / status.refreshed  // effects after resolution; status events immediately follow their bind/ally_guard resolution
intent.cancelled(owner_removed) → scene.entity_removed  // if a zero-HP enemy owns an active intent
```

`status.expired` is emitted in the post-gameplay status cleanup phase. Replay re-evaluates the existing Ally Guard target policy/eligibility and rejects tampered target selection. Bind event ordering and status-layer rules are defined in [DR-C-008](./22-step-c-status-immobilized.md); Ally Guard effective-defense and replay requirements are defined in [DR-C-009](./23-step-c-ally-guard.md).

Event envelope получает:

- `eventId`;
- canonical `eventType`;
- `eventVersion`;
- campaign/session/scene scope;
- post-commit `sceneRevision`;
- `serverTick`;
- monotonic `serverSequence`;
- `causedByRequestId` for command-caused event;
- seed only in GM/audit-safe channel.

`scene.spawn_accent` — derived UI notification и не записывается как gameplay event. `command.accepted`/`command.rejected` — transport result.

---

## 14. Replay и state hash

### Replay algorithm

```text
load initial snapshot S0
for event in journal ordered by serverSequence:
  validate event schema/version
  apply event reducer to S
  assert invariant(S)
return S
```

Для дополнительной проверки engine после каждого batch сохраняет:

```ts
{
  sceneRevision,
  serverTick,
  lastServerSequence,
  stateHash,
  rngStateHash
}
```

`stateHash` строится из canonical JSON с отсортированными entity IDs, card containers, statuses и intents. Нельзя использовать JSON.stringify для Map без canonicalization.

Replay не вызывает random functions. Все random outcomes уже содержатся в event payload или восстанавливаются через recorded seed и versioned RNG algorithm. Replay принимает historical `hp.changed` v1 и валидирует формулу и итоговый HP для `hp.changed` v2 (`fable.damage.v1`). `scene.entity_removed` восстанавливает `removed` state и освобождение клетки. Retreat replay восстанавливает mode, HP, contact immunity, event group and hash из событий либо детерминированного tick. `hero.canEnterRangedMode` — authoritative state; если равно `true`, участвует в runtime state, snapshot, state hash и replay.

---

## 15. Adapter boundaries после Step C

### Room adapter

Room adapter преобразует validated `CommandEnvelope` в `InternalCommand`, вызывает engine и отправляет `CommandResult` + filtered events. Он не знает правил damage/pathing.

### Persistence adapter

Persistence adapter получает committed batch:

```ts
{
  previousRevision,
  nextRevision,
  events,
  snapshotHint,
  idempotencyResults
}
```

Сначала commit persistence, затем broadcast. Если persistence failure — room не объявляет batch принятым и применяет retry/scene lock policy; engine не принимает второй раз тот же requestId.

### Projection adapter

Projection adapter принимает internal state и role context, затем удаляет запрещённые поля. Нельзя строить Player projection через сериализацию полного GM object с последующим UI hiding.

---

## 16. Recommended module layout

```text
packages/rules/src/
├── engine/SimulationEngine.ts
├── engine/types.ts
├── engine/cleanup.ts
├── clock/TickClock.ts
├── scheduler/InputWindow.ts
├── scheduler/orderCommands.ts
├── grid/Grid.ts
├── grid/collision.ts
├── entities/EntityRegistry.ts
├── modes/heroMode.ts
├── movement/playerMove.ts
├── movement/pathing.ts
├── combat/playCard.ts
├── combat/damage.ts
├── combat/targeting.ts
├── decks/deckState.ts
├── resources/hp.ts
├── resources/stamina.ts
├── statuses/statusSystem.ts
├── intents/intentSystem.ts
├── outcomes/outcomeSystem.ts
├── journal/EventJournal.ts
├── replay/replay.ts
├── rng/DeterministicRng.ts
└── index.ts
```

Pure formulas (`damage.ts`, `targeting.ts`, `pathing.ts`) должны иметь unit tests без engine. Integration tests создают engine и проверяют event sequence.

---

## 17. Test matrix

### Unit tests

- координаты, bounds, orthogonal movement;
- wall/statue/occupancy collision;
- diagonal contact;
- range and LoS;
- damage formula and melee magic multiplier;
- staged `fable.damage.v1` rounding, HP clamp and damage-source metadata;
- stamina cost 0/positive;
- status refresh and expiry;
- target filtering and seeded tie-break;
- deck container invariant;
- intent fallback when impossible;
- state transition validity.

### Integration tests

1. `player.move` changes one cell and emits one movement event.
2. Two players targeting the same cell resolve deterministically; only one succeeds.
3. Player and enemy due in same window resolve players first.
4. Устаревший global `clientRevision` сам по себе не отклоняет player move/mode; при закрытии окна legality проверяется по live state. Apply-time rejection leaves gameplay state, `sceneRevision` and domain-event journal unchanged (tick/window bookkeeping may still advance); `input_window` records остаются metadata. Stale `clientCardRevision` returns `STALE_CARD_REVISION` without card/HP/stamina mutation.
5. Duplicate `(sessionId, actorId, requestId)` creates no additional gameplay mutation/event and returns the saved result; equal `requestId` values for different actors/sessions remain independent.
6. DR-C-003 retreat resolves one ordered free attack per eligible surrounding enemy and grants immunity; no duplicate `hp.changed` on unchanged HP.
7. Contact starts melee; ranged mode requires authoritative `hero.canEnterRangedMode === true`.
8. Melee magic halves damage but preserves status potency.
9. Impossible ranged intent cancels and starts a valid fallback.
10. Stamina regenerates exactly at 300 ticks, stops at max, and is disabled for non-active heroes.
11. Expired status disappears during cleanup.
12. Event replay equals live final state and state hash.
13. `critically_injured` hero remains in scene and cannot act.
14. A zero-HP enemy is immediately excluded, then cleanup cancels its active intent and emits `scene.entity_removed` before freeing the cell; v2 event replay preserves the same state hash.
15. Ended scene rejects player commands.

### Golden scenario

The first checked-in intent transcript uses `rootSeed = "fable-step-c-001"` with a fixed `slag_shooter` and two equally ranked targets; it compares the complete intent event sequence, RNG audit sidecars and final `stateHash`. As later increments add the remaining Quarantine Gates fixtures, extend the golden coverage without weakening this exact intent transcript. GM-only numerical details remain in the privileged fixture, separate from public projections.

---

## 18. Step C Definition of Done

Step C is complete only when:

- [ ] `packages/rules` runs headless with no browser, room or database;
- [ ] 20 Hz clock and 250 ms windows are covered by tests;
- [ ] player → enemy → environment ordering is deterministic;
- [ ] all runtime invariants are asserted after every batch;
- [ ] movement, collision, contact and retreat work;
- [ ] modes and card execution work for the first-slice fixtures;
- [ ] intent lifecycle, impossible-intent fallback and seeded target selection work;
- [ ] HP, stamina and status timers use ticks;
- [ ] journal and replay produce identical state hash;
- [ ] no client-supplied outcome value is trusted;
- [ ] at least one golden transcript is committed;
- [ ] the engine is consumable through an adapter without importing transport or UI code.

Only after this checklist passes should development proceed to Step D/Stage 4 content fixtures and then the Authoritative Server Room.

---

## 19. Open questions intentionally deferred

These are not blockers for the headless engine if the interfaces remain versioned:

1. whether future complex card effects use a typed effect DSL or code-backed handlers;
2. full `scene_transfer` payload and campaign-level narrative semantics;
3. exact stamina overload tuning after playtest;
4. persistence transaction retry policy under database outage.

Any decision that changes event shape, timer semantics, ordering, or state transitions requires a new Decision Record and contract version review.
