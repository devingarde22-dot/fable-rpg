# Fable — Step B Review: События и event envelope

**Статус отчёта:** PROPOSAL для реализации; существующие CONFIRMED-правила не изменяются.
**Дата:** 2026-10-27
**Объект review:** типы событий первого vertical slice, серверный event envelope, payloads, ordering, visibility и replay metadata.

## 1. Scope

В scope входят только:

- канонический envelope подтверждённого server event;
- классификация event types и минимальные payloads для первого vertical slice;
- причинность command → events, идемпотентность и группировка нескольких событий одной операции;
- порядок событий при 20 Hz, input window 250 ms и фазах players → enemies → environment;
- metadata, необходимая для deterministic replay, checkpoint и rollback;
- field-level visibility событий для TV, Player, GM и AI;
- сопоставление с TIME-*, VIS-*, MOVE-*, COMBAT-*, DECK-*, RESOURCE-*, STATUS-*, INTENT-*, MAP-*, SAVE-* и GM-*;
- конкретные конфликты, acceptance checks и список файлов реализации.

Вне scope: новые игровые правила, новые эффекты карт, новые формулы урона, новый intent DSL, UI-анимации, полная auth-модель, production scaling, изменение gameplay semantics rollback и изменение лора. Поля/семантика, которых нет в CONFIRMED-документах, помечены `OPEN_QUESTION`.

## 2. Вывод

Текущий `EventEnvelope` — правильная минимальная отправная точка, но не достаточный production-контракт. Он фиксирует `eventId`, `eventType`, `eventVersion`, `sceneId`, `sceneRevision`, `serverTick`, `serverSequence`, optional `seed`, `causedByRequestId`, `actorId` и `payload`, однако не различает:

1. глобальный порядок journal и порядок внутри сцены;
2. одну команду, породившую несколько событий, и отдельные события scheduler;
3. domain event в append-only journal и его role-filtered transport projection;
4. обычное продолжение истории и результат rollback;
5. replay metadata (ruleset/content version, seed state, checkpoint base) и gameplay payload.

Рекомендуемый baseline: authoritative journal хранит полный GM-safe event, а transport получает отдельную filtered копию того же события. `payload` должен быть discriminated union по `eventType` с `additionalProperties: false`; общий envelope не должен позволять произвольный неизвестный event type или payload.

## 3. Recommended contract

### 3.1 Канонический authoritative envelope

```ts
type EventEnvelope<TPayload> = {
  eventId: string;                 // уникален в journal
  eventType: EventType;
  eventVersion: number;            // версия payload этого eventType
  campaignId: string;              // scope journal/replay
  sessionId?: string | null;       // expedition/session scope
  sceneId?: string | null;         // null для campaign/session events
  sceneRevision: number;            // revision после применённой mutation
  serverTick: number;              // authoritative simulation tick
  serverSequence: number;          // монотонный journal order в campaign
  eventGroupId: string;             // одна atomic command/batch transaction
  eventIndex: number;              // порядок внутри eventGroupId, начиная с 0
  causedByRequestId?: string | null;
  causationEventId?: string | null; // для server-generated follow-up event
  actorId?: string | null;          // authenticated actor/entity, не client result
  seed?: string | null;             // только если event использовал randomness
  rulesetVersion: string;           // например fable-0.1
  contentVersion?: string | null;   // snapshot/content bundle, если применимо
  replay: {
    origin: "live" | "replay" | "rollback";
    baseCheckpointId?: string | null; // authoritative/audit only
    baseSequence?: number | null;
    rngAlgorithm?: string | null;
    rngStateAfter?: string | null; // opaque, GM/audit only
  };
  payload: TPayload;
};
```

`campaignId`, `eventGroupId`, `eventIndex`, `rulesetVersion` и `replay.origin` — рекомендуемые дополнения к текущему envelope. Они не вводят новое игровое правило, а делают существующие persistence/replay требования реализуемыми. `sceneId` должен стать nullable: `expedition.ended`, `checkpoint.created`, `checkpoint.restored`, `rollback.applied` и campaign/journal события могут не иметь активной сцены. Если команда принимает решение оставить `sceneId` обязательным в transport, для таких событий потребуется отдельный non-scene envelope; это хуже и создаёт два несовместимых контракта.

`sceneRevision` означает revision состояния, к которому относится результат. Для нескольких событий одной atomic operation все события должны либо иметь одинаковую post-commit revision, либо быть явно документированы как последовательные revisions. Рекомендуемый baseline — одна command/batch mutation увеличивает `sceneRevision` один раз, а `eventIndex` определяет порядок производных событий. `serverSequence` увеличивается для каждого journal event.

`serverSequence` должен быть монотонным в пределах `campaignId`, а не только `sceneId`: rollback, checkpoint и expedition events иначе нельзя корректно replay-нуть в единую историю. Для scene-local subscription клиент может дополнительно фильтровать по `sceneId`; это не меняет journal order.

### 3.2 Domain event и transport projection

Journal хранит один authoritative event с полными разрешёнными для GM/audit данными. Перед broadcast сервер строит projection:

```ts
type EventProjection<T> = {
  eventId: string;
  eventType: EventType;
  eventVersion: number;
  sceneId?: string | null;
  sceneRevision: number;
  serverTick: number;
  serverSequence: number;
  eventGroupId: string;
  eventIndex: number;
  payload: T; // уже redacted для конкретной роли
};
```

`seed`, exact damage formula, exact target, fallback reason, audit reason, checkpoint id и private hint text не должны автоматически попадать в Player/TV projection. Нельзя отправлять полный event и рассчитывать на сокрытие полей в UI: это прямо противоречит VIS-правилам.

`command.accepted` и `command.rejected` остаются transport responses, а не domain events: rejection не вызывает gameplay-state mutation и не попадает в append-only event journal как подтверждённое изменение. Authoritative `serverTick`/scheduler bookkeeping могут продолжаться независимо. Если нужен audit отказа, это отдельная audit запись GM/QA, не публичный event.

### 3.3 Event type registry для первого vertical slice

| Event type | Payload minimum | Visibility | Примечание |
|---|---|---|---|
| `scene.created` | `sceneId`, `sessionId`, grid/public setup refs | public projection + GM | Не передавать скрытые spawn conditions. |
| `scene.entity_moved` | `entityId`, `fromCell?`, `toCell`, `movementKind` | public, если entity public | Сервер вычисляет клетку; соответствует MOVE-001/002. |
| `card.drawn` | `heroId`, `cardInstanceId`, `destination`, `cardRevision` | owner + GM; не TV | Не раскрывать чужую карту; destination может быть redacted. |
| `card.played` | `heroId`, `cardInstanceId`, `mode`, target public projection, cost | public summary + owner + GM | Raw/final damage и formula только GM; карта должна быть safe-referenced. |
| `card.discarded` | `heroId`, `cardInstanceId`, `reason`, `discardRevision` | owner + GM | Не показывать TV exact card instance. |
| `stamina.changed` | `entityId`, `delta`, `current`, `reason` | owner + GM; TV no/rounded | Ring timer — projection metadata, не hidden RNG. |
| `hp.changed` | `entityId`, `delta`, `current`, `sourceId?`, `kind` | public/owner согласно scene; GM full | `rawDamage`, mitigation, hit multiplier и formula version GM-only. |
| `status.applied` | `targetId`, `statusKey`, public potency/timer projection, `layerId` | public subset/owner/GM | Full sourceId, stackIndex, removal rule per VIS-STATUS. |
| `status.refreshed` | `targetId`, `statusKey`, public expiry projection, `layerId` | same as status.applied | Не складывать duration/potency молча. |
| `status.expired` | `targetId`, `statusKey`, `layerId`, public reason | public subset/owner/GM | Exact removal diagnostics GM/audit. |
| `mode.changed` | `heroId`, `from`, `to` | owner + GM; safe public summary if needed | Не выдаёт состав filtered deck. |
| `intent.started` | `intentId`, `enemyId`, public icon/timer; target cell/area only if visibility/reveal policy explicitly approves | TV + players receive only approved public telegraph; GM full | Exact targetId/conditions hidden unless explicitly revealed. |
| `intent.cancelled` | `intentId`, `enemyId`, public cancellation summary | public telegraph removal; GM reason | `reason` must be redacted for players per INTENT-005/VIS. |
| `intent.resolved` | `intentId`, `enemyId`, public effect summary, result refs | public result + GM exact | Damage/status/movement produce their own events in deterministic order. |
| `intent.target_selected` | exact selection payload, including target cell | GM/audit only; separate public projection may include target cell only after visibility/reveal approval | Do not expose exact target identity, policy, seed or tie-break. |
| `hint.sent` | target-specific `hintId`, text, vibration | target player + GM/audit only | Other clients receive no placeholder event. |
| `scene.ended` | `sceneId`, outcome/status | public summary + GM | Exact diagnostic/audit GM. |
| `expedition.ended` | `outcome`, reward lock/public result, consequence ref | public safe summary + GM | `retreat`/`defeat` lock rewards per MAP-003/004. |
| `checkpoint.created` | `checkpointId` only GM/audit; public safe notification | GM/audit, safe player notification optional | Snapshot, seed state and exact label are not player payload. |
| `checkpoint.restored` | `checkpointId`, restored sequence/revision | GM/audit; player safe notification | May be internal to rollback transaction. |
| `rollback.applied` | `previousRevision`, `restoredRevision`, public-safe outcome | GM/audit + safe player notification | Never expose checkpoint id/source/reason to players. |
| `scene.transferred` | source/destination public refs, transferred scene ref | public summary + GM | Must not open closed-node reward automatically. |

`scene.spawn_accent` и `scene.spawn_applied` из текущего API являются transport/demo events, но отсутствуют в confirmed event list и vertical slice event registry. Их нельзя считать authoritative domain events без отдельного решения. Рекомендуется: `scene.spawn_applied` либо добавить в event registry как spawn mutation, либо заменить на существующий typed event; `scene.spawn_accent` оставить UI-only notification, производную от committed spawn event. Это `OPEN_QUESTION`, потому что текущий scaffold уже использует оба имени.

### 3.4 Производные события и порядок внутри command

Для одной команды сервер должен писать события в таком порядке:

```text
command player.play_card
→ card.played
→ stamina.changed
→ hp.changed and/or status.applied
→ status.refreshed/expired (если применимо)
→ mode.changed (если действие меняет персональный mode)
→ intent/retreat follow-up events (если правило запускает их)
```

Точная полнота sequence зависит от результата; нулевой эффект не должен притворяться damage event. Для melee retreat по MOVE-004/COMBAT-006 отдельные бесплатные атаки врагов должны иметь собственные `intent.resolved`/`hp.changed` события в порядке врагов, а затем `mode.changed` в `movement`. Это не новая механика, а нормализация уже подтверждённого правила.

В одном 250 ms input window scheduler должен:

1. принять команды и присвоить `serverReceiveSequence` (это metadata command, не event order);
2. отсортировать players → enemies → environment по TIME-004;
3. зарезервировать клетки/цели;
4. применить batch по current state;
5. присвоить eventGroupId каждой atomic command/batch;
6. emit events с возрастающими `eventIndex` и глобальным `serverSequence`;
7. commit state + journal transaction;
8. только после commit broadcast filtered projections.

Если два события имеют один `serverTick`, порядок определяется `serverSequence`, затем `eventIndex`; wall-clock timestamp не участвует в игровой семантике. `serverTick` — не sequence и не может использоваться для deduplication.

### 3.5 Replay и rollback metadata

Replay должен начинаться с checkpoint snapshot и применять события строго по `serverSequence`. Минимальная replay запись:

```json
{
  "baseCheckpointId": "checkpoint-city-before-quarantine-01",
  "baseSequence": 40,
  "rulesetVersion": "fable-0.1",
  "contentVersion": "slice-quarantine-gates-v1",
  "rngAlgorithm": "server-defined",
  "rngStateAfter": "opaque-state",
  "events": [
    {
      "serverSequence": 41,
      "serverTick": 820,
      "eventGroupId": "grp_42",
      "eventIndex": 0,
      "eventType": "intent.started",
      "seed": "seed-for-target-tiebreak"
    }
  ]
}
```

`checkpoints.last_event_sequence`, `ruleset_version` и `seed_state` уже предусмотрены database contract и должны быть источником baseline для replay. `sceneRevision` восстанавливается из snapshot, затем после rollback увеличивается согласно SAVE-002/system contract; старые события не переписываются и не удаляются. После rollback дальнейшая история должна иметь новые `serverSequence` и `replay.origin = "rollback"`; повторное применение старого requestId не должно выдать награду или повторить mutation.

Для случайного выбора цели по INTENT-006 seed хранится на событии, использовавшем tie-break, вместе с RNG audit sidecar. RNG algorithm, version, UTF-8 fork serialization and purpose-scoped SHA-256 derivation are fixed by [DR-C-002](../15-step-c-intent-simulation.md); random forks are stateless and deterministic from their recorded input, so this is no longer an open question for Step C intents. Persistence/checkpoint storage remains outside the current increment.

## 4. Affected Rule IDs

- **TIME-001** — только сервер создаёт подтверждённые события и определяет time/order.
- **TIME-002** — `serverTick` должен быть simulation tick 20 Hz, не wall-clock.
- **TIME-003** — `eventGroupId` отражает atomic batch после input window 250 ms.
- **TIME-004** — event order: players → enemies → environment; внутри группы receive sequence + actorId.
- **TIME-005** — rejected stale command не создаёт state-changing event.
- **PARTY-003** — event projections различаются для TV, player и GM.
- **VIS-правила из visibility matrix** — field-level redaction, no hidden data in reconnect/animation/error.
- **MOVE-001/002/004/005** — movement, blocked cells, retreat attacks и anti-reentry должны быть отражены event sequence.
- **COMBAT-001/002/003/004/005/006** — targets/LoS/damage/miss/retreat result events; formulas only GM where required.
- **DECK-001—007** — card container transitions, filtered deck, card draw/play/discard и stamina gate.
- **RESOURCE-001/002/003** — HP/stamina mutations and server timer projection.
- **STATUS-001—004** — status layers, non-additive refresh, expiry and immobilization duration.
- **INTENT-001—006** — enemy intent lifecycle, telegraph, cancellation reason, timers and seed-based tie-break.
- **MAP-001—004** — scene/node/expedition lifecycle, retreat/defeat locks and scene transfer.
- **SAVE-001/002** — checkpoint metadata, append-only rollback audit and full restore.
- **GM-001/002** — consequence only after GM confirmation; private hint target-only.

## 5. Conflicts and concrete resolutions

### C-01 — `sceneId` required in JSON Schema, но часть событий не scene-scoped

`event.schema.json` требует `sceneId`, тогда как database schema допускает nullable `scene_id`, а checkpoint/rollback/expedition events имеют campaign/session scope. **Решение:** сделать `sceneId` nullable и добавить `campaignId`/nullable `sessionId` в envelope. Не создавать искусственный scene id для campaign events.

### C-02 — `serverSequence` scope не определён

System contract называет его порядком события, database index предлагает `(scene_id, server_sequence)`, но replay и rollback требуют единой истории campaign. **Решение:** global monotonic sequence per campaign; scene-local cursor — derived query. Добавить unique `(campaign_id, server_sequence)`.

### C-03 — один command создаёт несколько событий, но нет grouping metadata

`causedByRequestId` связывает события с command, но не задаёт порядок и atomic group; одного requestId недостаточно для server-generated follow-ups. **Решение:** `eventGroupId`, `eventIndex`, optional `causationEventId`; одна transaction/group имеет общий causal boundary.

### C-04 — текущий event schema допускает любой `eventType` и любой payload object

Это не защищает от неизвестных полей, неправильного payload и дрейфа между API и runtime. **Решение:** discriminated union `oneOf` по eventType, typed `$defs`, `additionalProperties:false` для каждого payload. До фиксации всех payload schemas нельзя считать schema implementation-ready.

### C-05 — `scene.mode_changed` в system contracts vs `scene.mode_changed`/`mode.changed` в разных списках

System event list содержит `mode.changed`, API list — `scene.mode_changed`, vertical slice использует режим как personal hero state. **Решение:** domain canonical name `mode.changed` с payload `heroId`; если нужен scene pause, это отдельный event (`scene.paused`/`scene.pause_changed`) после решения semantics. API alias допустим только на transport boundary и должен быть нормализован до journal event.

### C-06 — API/scaffold содержат spawn и pause events, которых нет в confirmed registry

`scene.spawn_accent`, `scene.spawn_applied`, `scene.time_paused` реализованы/перечислены в API, но не входят в confirmed event list; `gm.pause_scene` также не имеет gameplay semantics. **Решение:** считать их provisional transport/scaffold events; не включать в authoritative registry до ADR/Rule ID. `scene.spawn_accent` должен быть UI-only и не replay source. `scene.spawn_applied` либо получает отдельный typed event contract, либо заменяется domain event. `scene.time_paused` не должен менять timers без подтверждённого pause rule.

### C-07 — database schema и JSON Schema расходятся по именам и обязательным metadata

DB использует `type`, `actor_user_id`, `id`; contract использует `eventType`, `actorId`, `eventId`, и DB пока не имеет `eventVersion`, `sceneRevision`, `serverTick`, `serverSequence`, `seed`, хотя docs требуют их. **Решение:** выбрать camelCase на transport/TypeScript, snake_case только persistence mapping; добавить все обязательные columns и append-only constraints/migration tests.

### C-08 — `seed` недостаточен для полного replay

Документы требуют fixed seed, а checkpoint хранит `seed_state`, но envelope содержит только optional single string seed. **Решение для Step C intents (DR-C-002):** journal event-local seed reference and audit sidecar with algorithm version, fork input, and before/after state; replay applies recorded outcomes and does not rerun selection. Persistent checkpoint encoding remains future persistence scope.

### C-09 — checkpoint/rollback notifications и visibility

System contract говорит о filtered snapshot, visibility matrix запрещает player checkpoint id/source/reason. **Решение:** journal GM/audit event содержит full rollback metadata; player/TV получают только safe notification и новый filtered snapshot, без checkpoint id, exact reason и audit payload.

### C-10 — current scaffold не соответствует confirmed 9×9 slice и envelope lifecycle

`CampaignRoom.ts` остаётся legacy demo: он использует 18×12, north/south/east/west, broadcast без revision/sequence/request id и mutation до journal/commit, поэтому не является authoritative implementation и не доказывает TIME-001/004/005. Step C headless Core Engine в `packages/rules` уже использует confirmed command contract (`up/down/left/right`, 9×9); будущий room adapter должен делегировать ему gameplay mutation/journal и доставлять только committed events.

## 6. Open questions

1. **RESOLVED (Step C, DR-C-002):** fixed-seed intent replay uses xoshiro128** `fable.rng.v1`, canonical UTF-8 fork input, SHA-256, and golden transcript coverage.
2. **RESOLVED (Step C, DR-C-001/C-003):** `sceneRevision` увеличивается один раз на accepted batch, если он содержит gameplay mutation; `serverSequence/eventIndex` задают event order. Rejected commands не изменяют gameplay state, revision или journal.
3. **OPEN_QUESTION:** canonical event name для personal mode — `mode.changed` или `scene.mode_changed`; рекомендация — `mode.changed`.
4. **OPEN_QUESTION:** являются ли spawn events частью gameplay domain или только текущим demo transport; определить новый Rule ID до их journal persistence.
5. **OPEN_QUESTION:** что именно означает `gm.pause_scene`/`scene.time_paused` для timers, input windows, intent resolution, reconnect и replay? До решения не считать state-changing contract готовым.
6. **OPEN_QUESTION:** нужен ли отдельный `checkpoint.restored` domain event при rollback, или только `rollback.applied` + fresh snapshot? Рекомендация — не дублировать state mutation; использовать `rollback.applied`, а `checkpoint.restored` оставить audit/internal alias.
7. **OPEN_QUESTION:** какая политика ordering для server-generated events, которые появились после исходного command (например, timer-driven stamina regeneration): отдельный eventGroupId на tick или causation chain от исходного intent? Рекомендация — новый group per scheduler resolution, `causationEventId` на trigger event.
8. **OPEN_QUESTION:** какие именно HP/status fields public в каждой сцене? Visibility matrix допускает scenario-dependent HP/status, но event payload schemas требуют explicit projection policy before implementation.
9. **OPEN_QUESTION:** какое максимальное окно хранения/retention для append-only journal и replay snapshots? Это не меняет gameplay, но требуется для production persistence.
10. **OPEN_QUESTION:** какой формат `contentVersion` и как replay фиксирует версии card/enemy/intent templates? Рекомендация — immutable content bundle id на session/checkpoint.

## 7. Acceptance checks

### Contract/schema

- [ ] Валидный event каждого canonical type проходит discriminated JSON Schema; неизвестный eventType, неизвестное поле и неправильный payload отклоняются.
- [ ] Events без сцены (`expedition.ended`, checkpoint/rollback) валидируются с `sceneId: null` и корректными campaign/session refs.
- [ ] `eventId` уникален; `(campaignId, serverSequence)` уникален и монотонен.
- [ ] `eventGroupId + eventIndex` однозначно восстанавливают порядок событий одной atomic operation.
- [ ] Event с одинаковым `causedByRequestId` не создаётся повторно при retry того же command.

### Ordering/simulation

- [ ] При одном input window события сортируются players → enemies → environment.
- [ ] Внутри группы сохраняется `serverReceiveSequence`, затем стабильный `actorId` tie-break.
- [ ] Два события одного tick упорядочиваются `serverSequence`, а не client timestamp.
- [ ] Stale command не меняет state и не добавляет domain event.
- [ ] Event broadcast начинается только после transaction commit.
- [ ] Клеточные reservations и movement events не допускают двух entities в одной клетке.

### Replay/rollback

- [ ] Fixed seed + identical checkpoint + identical ruleset/content version воспроизводят тот же event sequence и state hash.
- [ ] Replay применяет события строго от `baseSequence` по global `serverSequence`.
- [ ] Checkpoint содержит snapshot version, last event sequence, ruleset/content version и RNG state metadata.
- [ ] Rollback не удаляет старый journal и создаёт новый rollback event/sequence.
- [ ] Retry исходного command после rollback не дублирует reward или mutation.
- [ ] После rollback reconnect получает новый filtered snapshot с актуальной revision.

### Visibility/security

- [ ] TV никогда не получает seed, exact targetId, hidden formula, fallback reason, audit reason, чужие карты или checkpoint id.
- [ ] Player получает только свою руку/defense slot/private hint; другой player не получает эти поля.
- [ ] `intent.started` раскрывает только public telegraph; hidden target and selection rationale остаются GM-only.
- [ ] `hp.changed`/`stamina.changed` соответствуют scene visibility policy, а GM получает полный diagnostic payload.
- [ ] `hint.sent` сериализуется только target player и GM/audit; другие клиенты не получают redacted placeholder.
- [ ] Reconnect и animation/spawn payload не повышают visibility.

## 8. Файлы, которые придётся изменить

Изменения ниже являются планом реализации; в рамках этого review изменён только данный отчёт.

1. `/home/ubuntu/lilovaya-gar/packages/contracts/event.schema.json` — nullable scope refs, discriminated event union, typed payloads, grouping и replay metadata.
2. `/home/ubuntu/lilovaya-gar/packages/contracts/visibility.schema.json` — при необходимости annotation для event-level/role-specific redaction; базовый enum уже достаточен.
3. `/home/ubuntu/lilovaya-gar/docs/03-system-contracts.md` — canonical envelope, event registry, sequence scope, post-commit broadcast и sceneId semantics.
4. `/home/ubuntu/lilovaya-gar/docs/08-api-specification.md` — нормализовать server event names, transport projection и spawn/pause status.
5. `/home/ubuntu/lilovaya-gar/docs/09-database-schema.md` — campaign-scoped sequence, eventVersion/revision/tick/seed/group columns, indexes и append-only constraints.
6. `/home/ubuntu/lilovaya-gar/dev/database/schema.ts` — Drizzle migration для полноценной campaignEvents таблицы и command/event idempotency; destructive migration не выполнять автоматически.
7. `/home/ubuntu/lilovaya-gar/dev/server/CampaignRoom.ts` — оставить room transport adapter: читать committed state/events из `packages/rules`, выполнять broadcast/reconnect и filtered projections; не размещать там simulation/journal.
8. `/home/ubuntu/lilovaya-gar/dev/client/room-client.ts` — принимать typed projections/sequence, не рассчитывать state, обрабатывать reconnect и safe rejection/event filtering.
9. `packages/contracts/event-payloads/*.schema.json` или эквивалентный typed contract module — отдельные payload definitions для canonical event types (новая директория/файлы).
10. `packages/rules/src/journal/`, `packages/rules/src/replay/`, `packages/rules/tests/` — Core Engine event/journal/replay implementation and tests per DR-C-001; contract and visibility tests remain in their owning packages.
11. `docs/02-confirmed-rules.md` — только после ADR для remaining naming/pause/spawn questions; RNG/intent decisions are now in DR-C-002.

## 9. Implementation boundary

Эта последовательность — историческая review recommendation. DR-C-001/002 уже фиксируют package boundary, typed intent schema and versioned intent RNG; Step C headless journal/replay and golden tests exist. Любой последующий server/persistence/UI increment всё ещё требует закрыть относящиеся к нему naming/pause/spawn decisions, role-filtered projection schemas and transactional delivery. Нельзя отправлять full authoritative events напрямую клиентам.
