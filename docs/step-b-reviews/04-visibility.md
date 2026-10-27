# Fable — Visibility и projections review

**Статус:** REVIEW / IMPLEMENTATION BASELINE PROPOSAL  
**Дата:** 2026-10-27  
**Scope:** только field-level visibility, role-specific DTO и AI context packet для TV, Player, GM и AI. Игровые правила, баланс, лор и state machine не пересматриваются.

## 1. Scope и вывод

Проверены product constitution, glossary, confirmed rules, system contracts, visibility matrix, vertical slice, API specification, database schema, AI developer guide и четыре JSON Schema.

Канонический принцип сохраняется: server state не сериализуется целиком; backend строит отдельную проекцию для каждого recipient и фильтрует поля **до** сериализации и broadcast. TV получает public projection, Player — public projection плюс собственные разрешённые private fields, GM — полную авторизованную GM projection, AI — не projection роли, а отдельный allow-listed context packet.

Главный технический вывод: текущие документы описывают допустимые поля, но существующие schemas не гарантируют их соблюдение. `event.schema.json` допускает `seed` на общем wire envelope, `payload` в command/event не типизирован, а `visibility.schema.json` описывает annotation, не связывая её с полями named DTO. Поэтому до реализации нужны отдельные discriminated projection/event schemas и единый registry visibility policy.

## 2. Recommended contract

### 2.1 Discriminated projections

Каждый snapshot должен иметь discriminator `projection` и валидироваться соответствующей schema. Рекомендуемые типы:

- `TVSceneProjection`: `projection: "tv"`; `sceneRevision`, public grid/obstacles, public entity positions, public HP только если разрешён сценарий, public status subset/VFX, intent icon, public timer, target cell/area only after explicit visibility/reveal approval, public scene events.
- `PlayerSceneProjection`: `projection: "player"`, `playerId`/`heroId`; всё разрешённое TV плюс состояние собственного героя, own HP/maxHP, stamina/maxStamina, mode, own full statuses, filtered hand до 5 карт, defense slot, server-computed available targets, movement directions, private hints только адресата. Чужие hand, defense slot, draw pile и discard не включаются.
- `GMSceneProjection`: `projection: "gm"`; полная **авторизованная** runtime projection для единственного GM: exact intents/targets, all hands/defense slots/discards/draw piles, full status layers, formulas, seeds, hidden lore, audit, proposals и редакторы. Это не означает отправку необработанного server/database state: поля всё равно должны быть типизированы и разрешены policy.
- `AIContextPacket`: `projection: "ai_context"`; explicit allow-list с `contextVersion`, `campaignId`, `sceneId`, `rulesetVersion`, `publicFacts`, опциональными `gmFacts`, `recentEvents`, `availableTemplates`. AI не получает generic `GMSceneProjection`, credentials, чужие руки по умолчанию, seed, audit или возможность применить command.

Для Player snapshot до боя рекомендуется либо отсутствие полей `hand`/`defenseSlot`, либо заранее утверждённый `null`; нельзя подменять скрытые объекты fake/null без фиксации wire semantics. Для slice предпочтительнее отсутствие полей, которые неприменимы в текущем mode, и явные `movement.directions`.

### 2.2 Field policy

| Поле | TV | Player-владелец | Другой Player | GM | AI |
|---|---|---|---|---|---|
| `entity.id`, `kind`, public `position` | public | public | public | yes | only packet |
| hero HP/maxHP | public only when scene policy allows | yes | public only when scene policy allows | yes | only packet |
| own `mode` | no/scene-safe subset | yes | no unless public | yes | only packet |
| exact card instance/template | no | yes for own hand/defense | no | yes | no by default |
| draw pile | no | no | no | yes | no by default |
| own discard | no | filtered own discard if product needs it | no | yes | no by default |
| stamina/maxStamina | no or rounded public value | yes | no | yes | only packet |
| statuses | public subset/VFX | full own layers allowed by policy | public subset | full | only packet |
| enemy HP | public only when scene policy allows | same public subset | same public subset | yes | only packet |
| intent icon/timer | public telegraph | public telegraph | public telegraph | yes | only packet |
| exact intent key/conditions/fallback/targetId | no | no unless explicitly revealed | no | yes | only packet |
| target red cell/area | only when explicitly approved public telegraph | only when explicitly approved public telegraph | only when explicitly approved public telegraph | yes | only packet |
| seed, raw/final formula, audit reason | no | no | no | yes/audit | no by default |
| GM lore/hidden route/reward | no | no | no | yes | only explicitly selected |
| private hint text | no | target only | no | GM/audit | no unless requested in packet |
| rollback checkpoint id/reason | no | safe notification only | safe notification only | yes | no |

`HP public по сценарию`, `stamina rounded`, public status и conditional reveal не должны оставаться неявной UI-логикой. Нужна versioned scene visibility policy, например `scenePolicy.publicHp`, `scenePolicy.publicEnemyHp`, `scenePolicy.publicStatuses`, но конкретный wire shape этой policy — OPEN_QUESTION до отдельного решения.

### 2.3 Event fan-out

Raw event и published event должны быть разными понятиями. Simulation/journal сохраняет полный event для GM/audit. Для каждого recipient backend создаёт typed filtered event. Один raw payload нельзя broadcast всем ролям.

`seed` допускается только в GM/audit projection и не должен сериализоваться в TV/Player/AI. `exact targetId`, hidden reason, fallback pool и raw formula аналогично удаляются, а не маскируются.

Каждый event registry entry должен содержать: `eventType`, `eventVersion`, payload schema, allowed recipients, per-field visibility, `seedPolicy`, causality policy и reveal condition. `event.schema.json` остаётся envelope primitive только после добавления output policy; его generic `payload: object` недостаточен как wire contract.

### 2.4 Backend boundary и cache

Projection service строит DTO из authoritative simulation state. `scenes.gm_state` не выбирается в TV/Player DTO. `scene_projections` может быть cache для reconnect/debug, но не source of truth; cache key должен учитывать `sceneRevision`, role и, для Player, конкретного `playerId`. Reconnect должен повторно пройти тот же policy path и не повышать visibility.

AI packet строится отдельным adapter-ом с allow-list и context hash. Передача GM facts допустима только если конкретный запрос и выбранные поля явно разрешены; `gmFacts: []` в API не должен означать автоматическую передачу всего GM state.

## 3. Examples

### 3.1 TV snapshot

```json
{
  "projection": "tv",
  "sceneRevision": 52,
  "scene": {
    "id": "scene_01",
    "grid": { "width": 9, "height": 9 },
    "obstacles": [{ "id": "wall_01", "kind": "wall", "position": { "x": 4, "y": 4 } }],
    "entities": [
      { "id": "hero_01", "kind": "hero", "position": { "x": 1, "y": 8 }, "hp": 1100 },
      { "id": "enemy_01", "kind": "enemy", "position": { "x": 7, "y": 3 },
        "publicIntent": { "icon": "ranged_attack", "remainingMs": 8200, "targetCell": { "x": 1, "y": 8 } } }
    ]
  }
}
```

Этот пример предполагает, что visibility/reveal policy отдельно разрешила target cell для public telegraph. Без такого решения поле `targetCell` полностью опускается. DTO не содержит hand, stamina, exact intent key, exact target identity, seed, audit reason и GM lore.

### 3.2 Player snapshot в бою

```json
{
  "projection": "player",
  "playerId": "player_01",
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
  "availableTargets": ["enemy_01"],
  "sceneRevision": 52
}
```

`availableTargets` — результат серверного фильтра на текущей revision, а не гарантия, что target останется доступен после следующей команды. Клиент не присылает raw/final damage.

### 3.3 GM event

```json
{
  "projection": "gm",
  "eventId": "evt_91",
  "eventType": "status.applied",
  "eventVersion": 1,
  "sceneId": "scene_01",
  "sceneRevision": 53,
  "serverTick": 9000,
  "serverSequence": 91,
  "seed": "seed_opaque",
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

Player может получить redacted payload с `statusKey` и expiry, если это разрешено policy; TV — только public status/VFX. Raw GM event не broadcast.

### 3.4 AI context packet

```json
{
  "projection": "ai_context",
  "contextVersion": 1,
  "campaignId": "camp_01",
  "sceneId": "scene_01",
  "rulesetVersion": "fable-0.1",
  "publicFacts": [{ "type": "enemy_telegraph", "icon": "ranged_attack" }],
  "gmFacts": [{ "type": "scene_goal", "value": "protect_witness" }],
  "recentEvents": [],
  "availableTemplates": []
}
```

`gmFacts` здесь — только явно выбранный факт. Это не право AI читать GM projection.

## 4. Affected Rule IDs

- `PARTY-001`, `PARTY-002`, `PARTY-003` — ownership, один GM и role-specific device projections.
- `TIME-001`, `TIME-002`, `TIME-003`, `TIME-005` — server authority, server timer/tick, input/revision consistency и safe stale errors.
- `MOVE-001`—`MOVE-005` — public positions, movement mode, arrows, retreat и доступность действий.
- `DECK-001`—`DECK-007` — одна колода, hand/defense slot, containers и mode-filtered cards.
- `COMBAT-001`—`COMBAT-005` — available targets, LoS/range и запрет раскрытия miss/damage internals.
- `RESOURCE-001`—`RESOURCE-003` — HP/stamina и timer visibility.
- `STATUS-001`—`STATUS-004` — public subset против full status layers, potency/expiry и action restrictions.
- `INTENT-001`—`INTENT-006` — public telegraph против exact intent/target/fallback/seed.
- `MAP-001`, `MAP-002`, `MAP-003`, `MAP-004` — node discovery, hidden route/lore и public outcomes.
- `SAVE-001`, `SAVE-002` — rollback notification, checkpoint secrecy и audit-only data.
- `GM-001`, `GM-002`, `GM-003` — proposal separation, private hint и AI/GM authorship.
- `VIS-*` — затребованы convention и документы, но в просмотренном `02-confirmed-rules.md` отдельные определения `VIS-*` отсутствуют. До добавления Rule IDs visibility matrix/system-contracts §7 являются normative baseline, но нельзя ссылаться на несуществующий конкретный `VIS-nnn`.

## 5. Conflicts и конкретные решения

### C-01 — Общая event schema допускает утечку seed

`event.schema.json` делает `seed` допустимым nullable полем общего envelope, а `event.schema` не содержит recipient policy. Это противоречит конституции и matrix: seed только GM/audit.

**Решение:** разделить internal/journal event и published role event или добавить обязательный event registry policy. Перед TV/Player/AI serialization `seed` удаляется; negative test проверяет отсутствие поля, а не его null-redaction.

### C-02 — Visibility annotation не гарантирует DTO safety

`visibility.schema.json` валидирует одну запись `{field, visibility}`, но не требует annotation для полей DTO, не задаёт bind к JSON path и не задаёт поведение conditional reveal. `event.schema.json`, `intent.schema.json` и API snapshots не различают output role.

**Решение:** named schemas `TVSceneProjection`, `PlayerSceneProjection`, `GMSceneProjection`, `AIContextPacket` плюс registry field policy. Annotation оставить как metadata primitive; не считать её заменой schemas.

### C-03 — Generic payload обходит schema validation

`command.schema.json:payload` и `event.schema.json:payload` имеют только `type: object`, `additionalProperties` внутри payload не ограничены. Это позволяет отправить/сохранить hidden input fields и разные incompatible event forms.

**Решение:** discriminated `oneOf`/`$defs` для команд и событий; typed payload per event type. Не добавлять новый effect DSL без отдельного решения.

### C-04 — GM “full projection” двусмысленна

System contracts называют её `full server projection`, а constitution запрещает каждому клиенту получать full server state. Эти формулировки совместимы только если GM получает полный **authorized typed projection**, не raw state/database JSON.

**Решение:** в contract заменить смысл на “full authorized GM projection”; явно исключить credentials, transport secrets и необъявленные internal fields.

### C-05 — Conditional public HP/status не имеет policy source

Matrix и contracts используют “по сценарию”, но API/DB/schema не определяют, где хранится и как версионируется scene visibility policy. Нельзя безопасно реализовать одинаковое поведение TV, Player и reconnect только UI-конфигурацией.

**Решение:** добавить versioned server-side policy reference в scene/projection registry и golden tests. Точная форма policy — OPEN_QUESTION.

### C-06 — Intent schema — template, не runtime/public DTO

`intent.schema.json` содержит template fields (`key`, `conditions`, `effect`, `fallbackKeys`, `visibility`), но не `intentId`, lifecycle, current target, server timer и reveal state. Использование его напрямую в projection смешивает скрытый template и runtime telegraph.

**Решение:** оставить schema для `IntentTemplate`; добавить `ActiveIntent` и role-specific public/GM projections.

### C-07 — Event fan-out и private hint не выражены в envelope

`hint.sent` должен быть виден только target player и GM/audit, но event envelope не содержит recipient policy. Простая broadcast-модель может утечь фактом или текстом hint.

**Решение:** private recipient fan-out на backend; другим ролям отправлять отсутствие event, не redacted event. В registry указать recipient selector `targetPlayerId + gm`.

### C-08 — AI API допускает неявную передачу GM facts

API request содержит `publicFacts`, `gmFacts`, `recentEvents`, но не описывает item-level allow-list и field redaction. Matrix разрешает AI только выбранный packet.

**Решение:** AI adapter принимает уже сформированный `AIContextPacket`; запрещает generic GM projection и хранит context hash. AI proposal остаётся `proposed` и не является state-changing event.

### C-09 — Reconnect cache не учитывает полный recipient identity

`scene_projections` имеет `role` и nullable `player_id`, но schema не фиксирует, что Player cache должен быть keyed by exact player/hero ownership и scene revision. Неправильный cache hit может отдать чужую hand.

**Решение:** composite uniqueness/cache key `(scene_id, scene_revision, role, player_id)` для player; TV/GM используют null player_id; AI packet не кэшировать как игровой projection без context hash.

## 6. OPEN_QUESTION

1. Какой точный wire format server timer каноничен: `remainingMs`, `expiresAtServerTick`, absolute server timestamp или комбинация? Клиентские wall-clock значения не могут быть источником правил.
2. Где и как версионируется scene visibility policy для “public HP”, enemy HP и public statuses: scene template, runtime scene state или отдельный registry?
3. Должно ли условное поле иметь typed condition object вместо строки `visibility.schema.json.condition`? Строка недостаточна для автоматической проверки reveal event.
4. Выбрать окончательно: отсутствующее поле или `null` для непригодных в текущем mode `hand`/`defenseSlot`; закрепить golden snapshot.
5. Нужны ли AI context packets с `gmFacts` для первого slice, если AI в slice read-only demonstration, или оставить `gmFacts` пустым до отдельного GM allow-list UX?
6. Какой canonical event registry является источником правды между API list и system-contract event list; в частности, остаются ли `scene.spawn_accent`, `scene.spawn_applied`, `gm.pause_scene`, `card.discarded`, `scene.transferred` в текущем slice?
7. Нужно ли добавить отдельные `VIS-001...` IDs в confirmed rules, либо формально считать §7 system contracts и visibility matrix нормативным visibility contract без новых Rule IDs?
8. Для public HP/status: раскрытие применяется ко всем игрокам одинаково или может зависеть от конкретного героя/эффекта? Нельзя выбирать это по UI convenience.

## 7. Acceptance checks

### Contract/schema

- [ ] Validator принимает только discriminator-correct TV, Player, GM и AI DTO.
- [ ] TV/Player schemas не имеют `seed`, exact hidden target, fallback pool, audit reason, GM lore, foreign hand/draw pile.
- [ ] Player schema запрещает чужую hand/defense/discard и проверяет ownership/recipient separately from JSON shape.
- [ ] GM schema принимает exact intent/target, all decks, seed и audit только в authorized GM session.
- [ ] AI packet валидируется отдельно и не является subtype/alias `GMSceneProjection`.
- [ ] Command/event payloads типизированы по discriminator; unknown fields отвергаются.
- [ ] `IntentTemplate` и `ActiveIntent` — разные schemas.
- [ ] Registry имеет event payload schema, eventVersion, recipient policy, field visibility, seed policy и causality policy.

### Runtime/negative visibility

- [ ] Player snapshot с несколькими героями не содержит чужую hand, defense slot, draw pile или discard.
- [ ] TV не получает seed, exact targetId, audit reason, formulas или private hint.
- [ ] Other Player не получает target player hint даже через event count, payload null или animation/spawn payload.
- [ ] GM получает full authorized projection и exact rejection reason, но не transport credentials.
- [ ] AI context содержит только явно выбранные fields; context hash/audit не раскрывает packet contents клиентам.
- [ ] Rejected command safeMessage не раскрывает hidden reason/target/seed.
- [ ] Reconnect на той же revision возвращает эквивалентную role-filtered projection; смена role/player не переиспользует cache.
- [ ] Conditional NPC/route/status reveal не появляется в animation/spawn payload до reveal event.
- [ ] Rollback notification игрока не содержит checkpoint id или техническую audit reason.

### Vertical slice

- [ ] До боя Player получает movement directions без обычной hand; в бою — до 5 ordinary cards и отдельный defense slot.
- [ ] TV видит 9×9 public map, public entities и telegraph, но не exact intent.
- [ ] GM видит exact target/formula/seed для ranged intent и status layers.
- [ ] `availableTargets` строится сервером для текущей `sceneRevision`; stale command не расширяет visibility.
- [ ] Private hint приходит только нужному player и GM; TV и остальные players не видят даже факт адресной подсказки.
- [ ] Rollback создаёт свежие filtered snapshots без повторной выдачи hidden reward/audit.

## 8. Файлы, которые придётся изменить

### Нормативные документы

- `/home/ubuntu/lilovaya-gar/docs/03-system-contracts.md` — закрепить named DTO, internal vs published events, GM wording и recipient fan-out.
- `/home/ubuntu/lilovaya-gar/docs/04-visibility-matrix.md` — добавить field paths, policy source, reveal conditions и per-event recipient rules.
- `/home/ubuntu/lilovaya-gar/docs/08-api-specification.md` — сослаться на typed snapshot/event DTO и AIContextPacket; описать reconnect/cache identity.
- `/home/ubuntu/lilovaya-gar/docs/09-database-schema.md` — типизированные JSONB/policy reference и projection cache key/uniqueness.
- `/home/ubuntu/lilovaya-gar/docs/05-vertical-slice.md` — добавить explicit projection assertions к существующим acceptance checks.
- `/home/ubuntu/lilovaya-gar/docs/02-confirmed-rules.md` — только после решения, нужны ли отдельные `VIS-*` Rule IDs; не менять молча.

### Contracts/schema

- `/home/ubuntu/lilovaya-gar/packages/contracts/event.schema.json` — typed event payload/output policy или разделение internal/published envelopes.
- `/home/ubuntu/lilovaya-gar/packages/contracts/command.schema.json` — discriminated command payloads и strict additional properties.
- `/home/ubuntu/lilovaya-gar/packages/contracts/intent.schema.json` — явно обозначить template semantics; не использовать как runtime DTO.
- `/home/ubuntu/lilovaya-gar/packages/contracts/visibility.schema.json` — typed condition/path semantics либо документировать annotation-only статус.
- Новые schemas, рекомендуемые имена: `/home/ubuntu/lilovaya-gar/packages/contracts/projection.schema.json`, `/home/ubuntu/lilovaya-gar/packages/contracts/active-intent.schema.json`, `/home/ubuntu/lilovaya-gar/packages/contracts/event-registry.schema.json`, плюс `$defs` для hero/enemy/card/status/scene.

### Runtime и тесты

- Projection/filter service до serialization и recipient-specific event fan-out.
- Typed DTO adapters для TV, Player, GM и AI.
- Event/command registry с visibility metadata.
- Unit и negative visibility tests, reconnect tests, snapshot/golden tests, event fan-out tests и e2e vertical-slice tests.
- Миграции DB не следует делать до решения по policy/cache key и без отдельного migration review; текущий review их не выполняет.

## 9. Ограничения review

Этот файл не меняет существующие правила и не вводит новые игровые механики. Все вопросы, где документы не выбирают конкретную wire semantics или canonical registry, помечены `OPEN_QUESTION`. Изменения production-кода, schemas, документов и миграций намеренно не выполнялись.
