# Fable — QA & Acceptance

**Версия:** 0.1  
**Статус:** CONFIRMED TEST PLAN

## 1. Уровни тестирования

### Unit

Проверяют чистые функции:

- урон и mitigation;
- крит и промах;
- stamina cost;
- card filter;
- status stacking;
- intent eligibility;
- pathfinding;
- target selection по seed;
- visibility filter.

### Simulation

Проверяют headless state machine без браузера:

- движение на 9×9;
- конфликт клеток;
- intent timer;
- разрешение batch;
- переходы режимов;
- победа, отступление, поражение;
- checkpoint и rollback;
- replay с тем же seed.

### Contract

Проверяют JSON Schema, command/event envelope, версии и error codes.

### Visibility

Проверяют field-level denylist/allowlist для TV, Player, GM и AI.

### Integration

Проверяют WebSocket room, persistence transaction, reconnect и idempotency.

### E2E

Проверяют полный vertical slice через браузерные клиенты.

## 2. Golden scenarios

### QA-001 — Move

**Given:** герой в `(2,2)`, клетка `(3,2)` свободна.  
**When:** player отправляет `player.move east`.  
**Then:** сервер создаёт `scene.entity_moved`, новая revision увеличена, TV/GM/владелец получают разрешённую проекцию.

### QA-002 — Blocked cell

**Given:** следующая клетка — стена.  
**When:** игрок отправляет движение.  
**Then:** `CELL_BLOCKED`, позиция не меняется, не создаётся movement event.

### QA-003 — Duplicate command

**Given:** один `requestId` уже применён.  
**When:** тот же command приходит повторно.  
**Then:** state не меняется второй раз, возвращается прежний result или `DUPLICATE_REQUEST`.

### QA-004 — Stale revision

**Given:** clientRevision старше текущего sceneRevision.  
**When:** игрок пытается сыграть карту.  
**Then:** command отклонена, HP/stamina/cards не изменились.

### QA-005 — Ranged telegraph

**Given:** стрелок имеет LoS до цели.  
**When:** начинается `ranged_shot`.  
**Then:** TV и Players видят icon attack и красную target cell, GM видит exact target/seed.

### QA-006 — Wall blocks ranged

**Given:** между стрелком и целью стена.  
**When:** intent завершается.  
**Then:** `intent_cancelled` с safe public result, стрелок выбирает fallback, урон не нанесён.

### QA-007 — Insufficient stamina

**Given:** stamina 0 и карта cost 1.  
**When:** игрок пытается сыграть карту.  
**Then:** `INSUFFICIENT_STAMINA`, карта не уходит в discard.

### QA-008 — Zero-cost card

**Given:** stamina 0 и карта cost 0.  
**When:** карта разрешена режимом и целью.  
**Then:** карта применяется и уходит в discard.

### QA-009 — Mode projection

**Given:** герой не в бою.  
**When:** игрок смотрит телефон.  
**Then:** видны стрелки, обычные игровые карты не видны; после входа в бой выдаются 5 карт + defense slot.

### QA-010 — Status

**Given:** герой получает Immobilized.  
**When:** он нажимает стрелку до expiry.  
**Then:** movement rejected; после expiry движение снова возможно.

### QA-011 — Intent cancel

**Given:** enemy intent target становится недоступной.  
**When:** timer завершается.  
**Then:** старый intent не применяет частичный effect, создаётся cancel event и запускается fallback.

### QA-012 — Visibility leakage

Проверить, что player и TV не получают чужую hand, exact enemy target, seed, GM-only lore, audit reason, hidden node content или rollback checkpoint id.

### QA-013 — Outcome

Проверить все исходы: success, retreat, defeat, gm_abort. Каждый outcome создаёт ровно один terminal event, корректно закрывает reward и применяет retry/scene transfer policy.

### QA-014 — Rollback

**Given:** checkpoint до сцены.  
**When:** GM подтверждает rollback.  
**Then:** HP, stamina, status, route, node availability, reward state и scene snapshot полностью совпадают с checkpoint; reward не дублируется.

### QA-015 — Reconnect

Клиент отключается в активном intent. После reconnect получает актуальные state, revision, timer progress и только свою projection.

## 3. Property tests

- HP никогда не становится отрицательным без явного dead/heavy-wounded transition.
- Стамина не превышает maxStamina и не уходит ниже 0.
- Карта всегда находится в одном контейнере.
- Две active entities не занимают одну клетку.
- Случайный выбор при одном seed воспроизводим.
- Replay event journal восстанавливает тот же state.
- Player projection никогда не содержит GM-only fields.
- Rollback не создаёт дубликат reward.

## 4. Acceptance metrics

| Метрика | Цель |
|---|---:|
| Утечки GM-only данных | 0 |
| Duplicate rewards | 0 |
| Deterministic replay divergence | 0 |
| Команды, отклонённые из-за stale state | <5% после reconnect tests |
| Network desync в локальном тесте | 0 |
| Длительность боевой сцены | 3–7 минут |
| Среднее время понимания ranged telegraph | <5 секунд в тесте |
| Успешное восстановление reconnect | 100% |

## 5. Definition of Done для задачи

Задача считается готовой, если:

1. код изменён только в согласованном scope;
2. добавлен unit/simulation/contract test по необходимости;
3. Rule IDs перечислены в PR/отчёте;
4. typecheck, lint и tests проходят;
5. visibility review пройден;
6. replay с фиксированным seed воспроизводим;
7. AI указал допущения и неразрешённые вопросы;
8. GM подтвердил изменения, влияющие на gameplay или lore.
