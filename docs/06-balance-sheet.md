# Fable — Balance Sheet

**Версия:** 0.1
**Статус:** CONFIRMED BASELINE / TUNING
**Reference party:** 4 игрока + GM

## 1. Цель

Этот файл является единственным местом для baseline-чисел первого vertical slice. Карты и сущности ссылаются на параметры, а не копируют формулы в разных местах.

## 2. Базовые параметры

```yaml
simulation_tick_hz: 20
input_window_ms: 250
base_player_hp: 1000
base_player_defense: 20
base_stamina: 3
stamina_regen_amount: 1
stamina_regen_interval_s: 15
normal_hand_size: 5
defense_slot_size: 1
minimum_intent_duration_s: 3
base_intent_duration_s: 15
melee_reentry_lock_s: 15
```

## 3. Формулы

Текущая executable formula определена в [DR-C-004](./18-step-c-hp-damage-resolution.md) и имеет версию `fable.damage.v1`:

```text
mitigation = 100 / (100 + targetDefense)
mitigatedDamage = ceil(rawDamage × mitigation)
finalDamage = ceil(mitigatedDamage × multiplier)
heal = ceil(baseHeal + maxHP × healPercent)
```

`multiplier` не округляется до умножения. В текущем Step C нет `hitMultiplier`, hit/miss/critical roll или magic damage channel; эти product mechanics требуют отдельных Decision Records до добавления в balance/content/runtime. Любое изменение float-semantics текущей формулы также требует versioned decision и replay-compatibility plan.

## 4. Enemy profiles

| Профиль | HP | Defense | Raw damage | Целевая длительность под фокусом 4 игроков |
|---|---:|---:|---:|---:|
| Small | 350 | 12–15 | 100–120 | 10–15 с |
| Normal | 900 | 20 | 140–180 | 25–35 с |
| Elite | 1800 | 28–35 | 220–300 | 45–70 с |
| Boss | 5000 | 35–45 | 320–450 | 2–3 мин |
| Main boss | 9000 | 45–55 | 450–650 | отдельная сцена, пока не slice |

HP не умножается автоматически на количество игроков. Для партии из 2–3 игроков используется encounter preset.

## 5. Карты vertical slice

| Тип карты | Raw damage/effect | Cost | Назначение |
|---|---:|---:|---|
| Базовая ближняя | 140 | 1 | простая проверка контакта |
| Сильная ближняя | 220 | 2 | burst с ограничением стамины |
| Базовая дальняя | 160 | 1 | дальняя карта с LoS |
| Контроль | 0 + 15 с | 2 | статус без большого урона |
| Поддержка | +20% defense / 15 с | 1 | защитный buff |
| Защита | 30–50% reduction или особый эффект | 0–2 | отдельный defense slot |

Конкретные карты героя в slice должны быть фиксированными fixtures. Их числа не должны генерироваться AI.

## 6. Статусы

| Статус | Baseline | Stacking |
|---|---|---|
| Immobilized | 15 с, движение запрещено | сила не суммируется, timer обновляется до большего |
| Ally Guard | +20% defense на 15 с | сила не суммируется, timer обновляется |
| Heavy Wounded | до конца сцены, действия запрещены | повтор не усиливает |

Минимальная длительность временного эффекта 3 с. Периодический тик не чаще одного раза за 3 с; стандартный интервал 15 с.

## 7. Late-game tiers

| Tier | HP multiplier | Damage multiplier | Дополнительно |
|---|---:|---:|---|
| 1 | 1.00 | 1.00 | baseline |
| 2 | 1.25 | 1.15 | resistance +10% |
| 3 | 1.60 | 1.35 | новые intent combinations |
| 4 | 2.10 | 1.65 | фазы и специальные правила |

Tier не меняет смысл базовых команд, только значения профиля и доступный content pool.

## 8. Golden examples

### Урон

```text
rawDamage = 160
targetDefense = 20
mitigation = 100 / 120 = 0.8333
finalDamage = ceil(160 × 0.8333) = 134
```

### Сильная карта по защите 35

```text
rawDamage = 220
targetDefense = 35
finalDamage = ceil(220 × 100 / 135) = 163
```

### Крит

```text
normalFinalDamage = 134
criticalFinalDamage = ceil(134 × 1.5) = 201
```

### Лечение

```text
baseHeal = 80
healPercent = 0.05
maxHP = 1000
heal = ceil(80 + 50) = 130
```

## 9. GM labels

| Число | Label |
|---:|---|
| HP до 350 | малый |
| HP 351–900 | базовый |
| HP 901–1800 | сильный |
| HP 1801+ | очень сильный |
| Defense 0–12 | почти отсутствует |
| Defense 13–20 | базовая |
| Defense 21–35 | хорошая |
| Defense 36+ | исключительная |
| Raw damage до 100 | слабый |
| Raw damage 101–160 | обычный |
| Raw damage 161–250 | сильный |
| Raw damage 251+ | очень сильный |

Labels — подсказка редактора, а не дополнительное правило.

## 10. Balance acceptance

- Обычный враг под фокусом 4 игроков живёт 25–35 секунд.
- Малый враг не убивает игрока одной базовой атакой.
- Суммарная сцена длится 3–7 минут без чтения диалогов.
- При нулевой стамине карта cost 1 не проходит, cost 0 проходит.
- Один status не может бесконечно продлеваться без cap.
- Playtest фиксирует фактический DPS, hit rate, stamina uptime, damage taken и длительность сцены.
