# DR-C-005 — Stamina & Resource Regeneration

**Статус:** CONFIRMED; implemented in commit `d237616` on branch `step-c-increment-5-stamina`; PR [#3](https://github.com/devingarde22-dot/fable-rpg/pull/3) is open, not yet merged.
**Дата:** 2026-10-27
**Область:** headless rules runtime, deterministic stamina regeneration, replay and tests.

## Решение

### Runtime model and initialization

Каждый hero содержит stamina runtime:

```ts
type StaminaRuntime = {
  current: number;
  max: number;
  nextRegenAtTick: number | null;
};
```

Новый герой начинает с `current = 3`. `max` поступает из config/preset и не может быть меньше 3. Для fixtures Increment 5 используется `max = 3`.

Если герой активен и stamina ниже максимума, первый timer due через 300 ticks от начального authoritative tick. При максимальном запасе или `aliveState !== "active"` timer отсутствует (`null`).

### Regeneration

Authoritative timer измеряется только `serverTick`: один tick равен 50 ms, интервал составляет 300 ticks (15 секунд). Регенерация выполняется в resource phase после players, enemies и environment, но до cleanup. Герои обрабатываются в стабильном порядке по `heroId`.

На due tick активный герой получает ровно 1 stamina. Если после восстановления он ещё ниже максимума, следующий due назначается через 300 ticks. При достижении максимума timer останавливается и становится `null`; при полном запасе восстановление не накапливается. Будущее успешное списание stamina должно запускать новый полный интервал от tick списания (`currentTick + 300`), а не выдавать пропущенные единицы. Расходующего игрового действия в Increment 5 нет.

Восстановление не выполняется, если `aliveState !== "active"`. Переход героя в `critically_injured` при HP=0 останавливает его regen timer. Mode не влияет на регенерацию: movement, melee и ranged разрешают её; mode transitions не перезапускают timer.

### Affordability

Pure helper проверяет целочисленные неотрицательные значения: стоимость 0 допустима при 0 stamina; положительная стоимость допустима только при `current >= cost`. Эта задача не добавляет расходующие commands, cards/decks, event мутацию от стоимости или command-level rejection path. При будущей реализации расходующего действия отказ должен происходить до любой мутации.

### Events, replay and hash

Каждое фактическое восстановление создаёт `stamina.changed` с `{heroId, current, maximum, reason: "regeneration"}`. Не создавать event при полном запасе или неактивном герое. Несколько hero changes на одном tick входят в одну event group и одну `sceneRevision`, упорядоченную по hero ID.

Replay принимает stamina event только если он соответствует активному hero, текущему maximum, ровно +1 stamina и точному due tick. Timer state является частью snapshot и canonical state hash; event replay и journal replay должны сходиться к идентичному состоянию.

### Границы и schema

Scene pause не реализуется в Increment 5: несмотря на существующие `gm.pause_scene` и `scene.pause_changed` JSON Schemas, их engine/runtime поддержка остаётся отдельной задачей. Increment 5 не добавляет pause command, pause event handling или pause-specific timer logic. Регенерация следует authoritative ticks; будущая pause реализация должна остановить сами ticks.

Существующая schema `stamina.changed` уже покрывает `reason: "regeneration"`. Её `maximum` ограничивается снизу 3. `command.schema.json` не меняется; иных wire-полей Increment 5 не добавляет.

## Definition of Done

- Runtime хранит current/max и deterministic next tick, стартовый current равен 3, max берётся из config/preset и не ниже 3.
- Регенерация ровно +1 на каждом 300-м due tick, timer останавливается при максимуме и не даёт catch-up; неактивные герои не восстанавливаются.
- Mode и HP damage не изменяются регенерацией; HP=0 останавливает регенерацию героя.
- Affordability helper разрешает нулевую стоимость при нуле и отклоняет недостаточную положительную стоимость без мутации.
- `stamina.changed`, replay и canonical `stateHash` дают точную детерминированную парность.
- Unit, integration, schema и replay tests проходят; Increment 4 golden transcript обновлён только из-за новых state fields.
- Pause, cards/decks, cost-consuming actions, statuses, UI, WebSocket, PostgreSQL и AI не добавлены.
