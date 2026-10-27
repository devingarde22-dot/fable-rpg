# Fable — Visibility Matrix

**Версия:** 0.1  
**Статус:** CONFIRMED  
**Назначение:** запретить утечки скрытой информации на уровне DTO и событий.

## 1. Роли

| Роль | Устройство | Назначение |
|---|---|---|
| `tv` | Общий экран | Публичная проекция сцены для всей комнаты. |
| `player` | Личный телефон | Состояние одного героя, игровые карты и личные сообщения. |
| `gm` | Планшет | Полный авторизованный state, редакторы и audit. |
| `ai` | Backend tool | Только явно переданный context packet; не является игровой ролью. |

## 2. Уровни видимости

- `public` — допустимо для TV и всех игроков.
- `player_private` — только владельцу героя и GM.
- `gm_only` — только GM и разрешённому backend tool.
- `conditional` — раскрывается после event/условия, затем становится public или player_private.
- `audit_only` — техническая информация только GM/QA.

## 3. Field-level matrix

| Объект/поле | TV | Player-владелец | Другой Player | GM | AI |
|---|---:|---:|---:|---:|---:|
| Позиция героя | public | public | public | yes | only if packet |
| HP героя | public по сценарию | yes | public по сценарию | yes | only if packet |
| Точные карты героя | no | yes | no | yes | no by default |
| Слот защиты героя | no | yes | no | yes | no by default |
| Стамина героя | no/rounded | yes | no | yes | only if packet |
| Статусы героя | public-проекция | full own | public subset | full | only if packet |
| Draw pile | no | no | no | yes | no by default |
| Discard | no | own filtered | no | yes | no by default |
| Enemy HP | public по сценарию | public subset | public subset | yes | only if packet |
| Enemy exact intent | no | no | no | yes | only if packet |
| Enemy attack icon | yes | yes | yes | yes | only if packet |
| Ranged target red cell | yes | yes | yes | yes | only if packet |
| Enemy targetId | no, unless public target | no, unless revealed | no, unless revealed | yes | only if packet |
| Intent seed | no | no | no | yes | no by default |
| GM-only lore | no | no | no | yes | only if packet |
| Private GM hint | no | target only | no | sender + audit | no unless requested |
| AI prompt | no | no | no | no | backend only |
| Audit reason | no | no | no | yes | no by default |
| Rollback source | no | safe notification only | safe notification only | yes | no |

## 4. Intent visibility

Игроки всегда видят простой телеграф:

- иконку атаки;
- красную клетку дальней атаки;
- красную область АОЕ;
- иконку движения, контроля или баффа.

Игроки не видят:

- точную формулу урона;
- seed;
- будущую цепочку намерений;
- скрытую причину выбора цели;
- fallback pool.

## 5. Node visibility

```text
undiscovered → silhouette visible
rumor         → public слух + неопределённые условия
discovered    → public description + known edges
active        → текущая сцена и разрешённые действия
completed     → public результат + закрытые/открытые связи
```

GM дополнительно видит политический слой карты, скрытые связи, настоящую награду, GM-only сцены и условия переноса.

## 6. Обязательные negative tests

1. Player не получает чужую руку при snapshot.
2. Player не получает draw pile, discard другого героя или GM-only lore.
3. TV не получает exact target, seed или audit reason.
4. Rejected command не раскрывает скрытую причину.
5. Reconnect не повышает уровень видимости.
6. Rollback notification не сообщает игроку скрытый checkpoint id.
7. AI context не содержит поля, отсутствующие в разрешённом packet.
8. Private hint получает только target player и GM.
9. Animation/spawn payload не раскрывает условного NPC до reveal.
10. Ошибка schema validation не отражает скрытые поля из входа.

## 7. Реализационное правило

Фильтрация выполняется на backend до сериализации. Нельзя отправлять полный объект и надеяться, что UI скроет поле. Каждое новое поле обязано иметь visibility annotation и тест для всех четырёх ролей.
