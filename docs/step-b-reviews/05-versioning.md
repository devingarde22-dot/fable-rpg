# Fable — Step B Review: Версионирование контрактов

**Статус отчёта:** PROPOSAL для реализации, не изменяет CONFIRMED gameplay semantics
**Дата:** 2026-10-27
**Scope:** contract versioning, compatibility и migration policy для command/event envelopes, payload schemas, HTTP/WebSocket API, projections, persistence snapshots/checkpoints и replay.

## 1. Scope и исходные ограничения

В область входят:

- версионирование wire-контрактов между Player/TV/GM и сервером;
- версионирование command и event envelope и их payload schemas;
- совместимость клиентов при reconnect, retry и rolling deploy;
- привязка campaign/session/checkpoint/replay к ruleset и schema version;
- безопасная миграция persisted JSONB, snapshots и event replay;
- совместимость visibility annotations и filtered projections;
- acceptance-проверки для vertical slice.

В область не входят изменение боевых формул, порядка разрешения команд, состава vertical slice, игровых исходов, лора или политики авторства GM. Любое изменение этих семантик требует отдельного Decision Record. Версия wire-контракта сама по себе не означает изменение gameplay rules.

Нормативные основания: `docs/00-product-constitution.md` (server authority, field-level visibility, rollback), `docs/02-confirmed-rules.md`, `docs/03-system-contracts.md`, `docs/04-visibility-matrix.md`, `docs/05-vertical-slice.md`, `docs/08-api-specification.md`, `docs/09-database-schema.md`, `docs/10-ai-developer-guide.md` и четыре JSON Schema в `packages/contracts`.

## 2. Наблюдения и текущий baseline

1. `event.schema.json` и `EventEnvelope` уже содержат обязательный целочисленный `eventVersion`; `campaign_events` также содержит `event_version`.
2. Command envelope содержит `requestId`, `sessionId`, `actorId`, `role`, `command`, `payload`, `clientRevision`, но не содержит версии command-контракта или версии payload schema.
3. HTTP API жёстко адресован как `/api/v1`, но WebSocket room join, commands, events и snapshots не имеют общей protocol version.
4. `campaigns.ruleset_version`, `checkpoints.ruleset_version` и AI `rulesetVersion` существуют, однако не определено, означает ли это gameplay ruleset, wire schema, content version или всё сразу.
5. Database document требует version/status для content records, `eventVersion` для событий и snapshot version для checkpoint, но отдельные поля `snapshot_schema_version`, `projection_schema_version` и `command_schema_version` не описаны.
6. `additionalProperties: false` во всех envelope schemas правильно защищает от неизвестных полей, но без negotiation/version policy старый клиент будет отвергать расширенный envelope, а сервер не сможет безопасно принимать несколько поколений клиентов.
7. Visibility schema имеет допустимые уровни `public`, `player_private`, `gm_only`, `conditional`, `audit_only`; новая версия не должна ослаблять фильтрацию или превращать неизвестное поле в видимое по умолчанию.

## 3. Recommended contract (предлагаемый целевой контракт)

### 3.1 Разделить четыре независимые оси версий

Рекомендуется не использовать одну строку `version` для разных задач:

- `protocolVersion` — версия транспортного envelope и negotiation. Меняется только при несовместимом изменении wire shape/семантики handshake.
- `schemaVersion` — версия конкретной JSON Schema payload/envelope. Меняется при изменении структуры, required-полей, типов, enum или visibility metadata.
- `eventVersion` / `commandVersion` — версия конкретного типа события/команды. Нужна для адресной эволюции, например `intent.resolved` v1 и v2.
- `rulesetVersion` — версия серверной игровой семантики и набора правил, уже зафиксированная для campaign/session/checkpoint. Не должна подменять schema version.

Рекомендуемый идентификатор должен быть namespaced и машинно сравнимым, например `fable.protocol.v1`, `fable.command.player.play_card.v1`, `fable.event.intent.resolved.v1`, `fable.snapshot.scene.v1`, `fable.ruleset.0.1`. Точная строковая форма — PROPOSAL; выбрать один формат до реализации.

### 3.2 Command contract

Предлагается добавить в command envelope:

```json
{
  "protocolVersion": "fable.protocol.v1",
  "schemaVersion": 1,
  "commandVersion": 1,
  "requestId": "req_01",
  "sessionId": "sess_01",
  "actorId": "player-02",
  "role": "player",
  "command": "player.play_card",
  "payload": {
    "cardInstanceId": "card-instance-123",
    "targetEntityId": "enemy-2",
    "targetCell": { "x": 7, "y": 3 },
    "mode": "ranged",
    "clientCardRevision": 4
  },
  "clientRevision": 41,
  "clientSentAt": "2026-10-27T03:00:00Z"
}
```

`commandVersion` относится к конкретному имени команды, а не к `sceneRevision`: `sceneRevision` остаётся optimistic-concurrency revision состояния. Сервер обязан валидировать сначала protocol/schema/version, затем auth/ownership, затем текущий `sceneRevision` и gameplay state. `requestId` и idempotency semantics не меняются.

Совместимость команд: сервер принимает только зарегистрированные версии. Для minor расширений можно принять старую версию и нормализовать её в каноническую внутреннюю команду. Для breaking change нужна новая `commandVersion`; молчаливое изменение смысла существующего `commandVersion` запрещено.

### 3.3 Event contract

Сохранить существующие обязательные поля `eventId`, `eventType`, `eventVersion`, `sceneId`, `sceneRevision`, `serverTick`, `serverSequence`, `payload`. Добавить к envelope при следующем согласованном изменении:

```json
{
  "protocolVersion": "fable.protocol.v1",
  "schemaVersion": 1,
  "eventId": "evt_1001",
  "eventType": "intent.resolved",
  "eventVersion": 1,
  "sceneId": "scene_01",
  "sceneRevision": 42,
  "serverTick": 880,
  "serverSequence": 1001,
  "seed": "seed-abc",
  "causedByRequestId": "req_01",
  "actorId": "enemy-1",
  "payload": {}
}
```

Event versions должны быть immutable для уже записанного journal: нельзя переписывать v1 задним числом. Для live broadcast сервер может отправлять только версии, поддержанные клиентом, либо выполнять серверную проекцию/адаптацию v2→v1. Для replay каноническим источником остаётся persisted event version; адаптация должна быть детерминированной и тестируемой.

### 3.4 Snapshot, projection и visibility

Каждый filtered snapshot должен иметь независимые метаданные:

```json
{
  "protocolVersion": "fable.protocol.v1",
  "snapshotSchema": "fable.snapshot.scene.v1",
  "projectionRole": "player",
  "projectionSubject": "player-02",
  "sceneRevision": 42,
  "rulesetVersion": "fable.ruleset.0.1",
  "state": {}
}
```

`projectionRole` и subject должны вычисляться сервером, а не доверяться клиенту. Для TV/Player/GM должны существовать отдельные schema/fixture и contract tests. AI получает только context packet с собственной schema version; AI не получает полный event или GM state автоматически.

Любое новое поле обязано иметь visibility annotation. При неизвестной annotation безопасный default — не сериализовать поле в TV/Player/AI projection и записать audit/validation failure; нельзя трактовать неизвестное поле как `public`. Это непосредственно поддерживает `VIS-*`, особенно правило field-level filtering и обязательные negative tests.

### 3.5 Version negotiation

При HTTP сервер публикует поддерживаемые версии в capability/handshake response; `/api/v1` остаётся внешней major линией до отдельного migration window. Для WebSocket `room.join` клиент сообщает `supportedProtocolVersions`, `supportedCommandVersions`, `supportedEventVersions` и `supportedSnapshotSchemas`. Сервер выбирает пересечение или безопасно отклоняет join кодом `UNSUPPORTED_CONTRACT_VERSION`, не раскрывая GM-only данные.

Рекомендуемый join-фрагмент:

```json
{
  "type": "room.join",
  "protocolVersion": "fable.protocol.v1",
  "supportedEventVersions": { "intent.resolved": [1], "scene.entity_moved": [1] },
  "supportedSnapshotSchemas": ["fable.snapshot.scene.v1"],
  "campaignId": "camp_01",
  "sceneId": "scene_01",
  "role": "player",
  "playerId": "player-02",
  "resumeFromRevision": 41
}
```

Capability response не должен перечислять скрытые gameplay/content facts. Наличие или отсутствие версии не должно раскрывать GM-only intent, target, seed или lore.

## 4. Compatibility policy

### 4.1 Разрешённые backward-compatible изменения

Без смены major/protocol line допускаются только изменения, сохраняющие старых потребителей:

- добавление optional поля, которое старый клиент может игнорировать;
- добавление нового event type, если клиент умеет игнорировать неизвестные события безопасно;
- расширение серверной реализации без изменения значения существующего поля;
- добавление нового visibility-redacted поля только в проекцию, для которой оно разрешено.

Из-за `additionalProperties: false` простое добавление поля в тот же envelope не является совместимым для валидатора старого клиента. Поэтому даже optional wire field должен либо быть исключён из старой schema response, либо выпускаться через новую schemaVersion и capability-aware serialization.

### 4.2 Breaking changes

Новая major/protocol или новая version конкретного типа обязательна при:

- изменении типа/формата существующего поля;
- изменении required/enum так, что старый клиент может не пройти validation;
- изменении смысла команды/event или порядка/семантики payload;
- изменении visibility в сторону более широкого раскрытия;
- удалении/переименовании поля;
- изменении правил декодирования snapshot/event, влияющем на replay или rollback.

Запрещено переиспользовать старый `eventVersion` для нового смысла. Запрещено принимать неизвестные `commandVersion` с best effort, если это может вызвать state mutation.

### 4.3 Compatibility matrix

| Производитель/потребитель | Policy |
|---|---|
| Новый сервер + старый клиент | Разрешать только при явном пересечении capabilities и адаптере; иначе reject до join. |
| Старый сервер + новый клиент | Клиент должен уметь fallback на поддержанную старую protocol/schema или показать безопасную ошибку. |
| Новый event producer + старый event consumer | Только через зарегистрированный down-converter с visibility tests. |
| Старый event journal + новый replayer | Обязателен versioned up-converter в каноническую внутреннюю модель. |
| Checkpoint старого ruleset | Восстанавливать под исходным pinned ruleset либо явно мигрировать до restore; не менять semantics молча. |
| Player/TV/AI projection | Никогда не down-convert через выдачу полей, запрещённых исходной роли. |

## 5. Migration policy

### 5.1 Общий принцип

Разделить schema migration и ruleset migration. Schema migration преобразует форму данных; ruleset migration меняет игровую семантику и требует Decision Record/GM policy. Автоматическая destructive migration запрещена (соответствует database и AI guide).

### 5.2 Event journal

Event journal append-only. Сохранять исходные `eventVersion`, `protocol/schema metadata`, `rulesetVersion`, scene/campaign identifiers и visibility classification. Не делать in-place rewrite. Для чтения использовать цепочку versioned up-converters: `event v1 → canonical internal vN`; результат replay должен быть детерминированным. При невозможности конвертации replay/rollback останавливается безопасной ошибкой, а не применяет частичный state.

### 5.3 Snapshots и checkpoints

Checkpoint обязан хранить минимум `snapshotSchemaVersion`, `rulesetVersion`, `lastEventSequence`, `seedState`, campaign/scene revision и visibility-safe snapshot metadata. При загрузке:

1. проверить checksum/структурную schema;
2. определить snapshot schema и ruleset;
3. применить только зарегистрированные non-destructive миграции;
4. прогнать invariant/visibility validation;
5. только после успешной валидации публиковать filtered snapshot;
6. сохранить migration audit (source version, target version, tool/build, timestamp, result).

Rollback по `SAVE-002` восстанавливает gameplay state checkpoint, но не удаляет audit и не переписывает старые события. После restore revision должна быть новой, чтобы stale commands не применились.

### 5.4 Commands

Persisted `command_requests.request_json` хранить с `commandVersion` и `schemaVersion`. При retry повторно валидировать идентичность requestId и версии; тот же requestId с другим payload/version — `DUPLICATE_REQUEST`/audit conflict, без state mutation. Старые команды можно нормализовать только через явный adapter и golden tests.

### 5.5 Content и templates

`node_templates`, `scene_templates`, `card_templates`, `enemy_templates`, `intent_templates` уже имеют `version/status`; их version должна быть content/template version, а не protocol version. Active campaign должна ссылаться на immutable published content version либо на явно выбранный набор. Изменение tuning values не должно переписывать historical event interpretation; для этого нужен новый content/ruleset release.

### 5.6 Retention/deprecation

Каждая версия должна иметь lifecycle `supported → deprecated → retired`. Сервер объявляет дату/условие прекращения поддержки. Retire разрешён только после проверки отсутствия активных sessions/checkpoints/replays, использующих версию, либо после утверждённого migration run. Сроки и количество одновременно поддерживаемых поколений — OPEN_QUESTION, не выбирать молча.

## 6. Affected Rule IDs

- **TIME-001, TIME-005:** version negotiation, stale command rejection и адаптация не могут менять server authority или превращать устаревшую команду в действие.
- **VIS-001…VIS-* (раздел visibility):** exact IDs необходимо подтвердить в полном реестре; текущие visibility rules требуют field-level filtering до сериализации и безопасной redaction при любой версии.
- **INTENT-005:** versioned `intent.cancelled`/`intent.resolved` обязаны сохранять невозможность без частичного эффекта и безопасную причину для GM-only/audit.
- **SAVE-001, SAVE-002:** checkpoint/rollback должны быть pinned к snapshot/ruleset version, восстанавливать полное состояние и не дублировать rewards.
- **GM-001, GM-002:** версия proposal/hint contract не должна обходить GM confirmation или private delivery.
- **PARTY-003:** capability/projection negotiation должна сохранять разделение TV/Player/GM; один общий полный DTO запрещён.
- **Правило системных контрактов §1–§2:** commands не создают events самостоятельно, events создаются после подтверждённой mutation, idempotency по requestId сохраняется.
- **Vertical slice acceptance §6:** stale revision, duplicate requestId, replay, reconnect, visibility и rollback должны быть проверены на нескольких contract versions.

Примечание: в `02-confirmed-rules.md` нет отдельного `CONTRACT-*` namespace. Рекомендуется добавить такие Rule ID отдельным Decision Record, а не переименовывать существующие игровые Rule ID.

## 7. Conflicts и конкретные решения

### CONFLICT-1 — Event version есть, command version отсутствует

`EventEnvelope`/БД требуют `eventVersion`, но `CommandEnvelope` и `command.schema.json` не различают поколения command payload. **Решение:** добавить `protocolVersion`, `schemaVersion`, `commandVersion` в следующую schema/API revision; до этого закрепить текущий baseline как v1 и не делать shape changes.

### CONFLICT-2 — `/api/v1` не совпадает с внутренними версиями

HTTP major version есть, но WebSocket/snapshot/payload version не определены. **Решение:** оставить `/api/v1` как transport line и ввести explicit protocol/schema negotiation для WebSocket, events, commands и snapshots; не считать `/api/v1` заменой event/ruleset version.

### CONFLICT-3 — `rulesetVersion` используется неоднозначно

Campaign, checkpoint и AI используют `rulesetVersion`, но schema/protocol/content semantics не разделены. **Решение:** зарезервировать `rulesetVersion` только для игровых правил; добавить отдельные schema/protocol/content fields. Existing `fable-0.1` мигрировать как baseline ruleset identifier после подтверждения формата.

### CONFLICT-4 — `additionalProperties:false` и утверждение о backward-compatible optional fields

Старый валидатор может отвергнуть новый optional envelope field. **Решение:** capability-aware serialization или новая schemaVersion; не отправлять новые поля старому клиенту только потому, что они optional по смыслу.

### CONFLICT-5 — visibility schema допускает `conditional`, но version policy не описывает condition

Без versioned condition semantics можно раскрыть поле раньше времени. **Решение:** condition/redaction должны иметь стабильный identifier, серверную evaluation policy и negative tests на каждую projection version. Нельзя мигрировать `conditional` в `public` автоматически.

### CONFLICT-6 — checkpoint содержит ruleset, но не явно snapshot schema

Database описывает snapshot version текстом, а таблица checkpoints перечисляет только `ruleset_version`. **Решение:** добавить отдельное `snapshot_schema_version` и migration audit в проект схемы БД; до фактической миграции считать это planned change, не менять существующую БД в рамках текущего отчёта.

### CONFLICT-7 — event type lists расходятся

API перечисляет `scene.mode_changed`, `scene.spawn_accent`, `scene.spawn_applied`, а system contracts перечисляет `mode.changed`, `scene.created`, `checkpoint.restored`, `scene.transferred`. **Решение:** создать canonical event registry с alias/migration mapping и выбрать одно имя для каждого события до production. Нельзя считать aliases совместимыми без явного registry и тестов.

## 8. Open questions

1. **OPEN_QUESTION:** какой точный формат version identifier утверждается: integer per type (`1`) или namespaced string (`fable.event.intent.resolved.v1`)?
2. **OPEN_QUESTION:** поддерживает ли сервер rolling deploy одновременно две protocol lines, или deployment atomic? От этого зависит обязательность live adapters.
3. **OPEN_QUESTION:** какой срок deprecation и сколько поколений клиента/event поддерживать?
4. **OPEN_QUESTION:** должен ли `eventVersion` оставаться integer для compatibility с текущим JSON Schema/БД, а namespaced type храниться отдельно?
5. **OPEN_QUESTION:** какая из двух номенклатур event type каноническая (`scene.mode_changed` или `mode.changed`, и аналогичные пары)?
6. **OPEN_QUESTION:** где хранить canonical event/command registry: в TypeScript source, отдельном JSON registry или документации с code generation?
7. **OPEN_QUESTION:** разрешается ли миграция active checkpoint между rulesets, или checkpoint всегда восстанавливается только под pinned исходным ruleset?
8. **OPEN_QUESTION:** какие поля должны входить в snapshot checksum и migration audit, чтобы не раскрывать GM-only payload?
9. **OPEN_QUESTION:** нужен ли отдельный `visibilityVersion` для conditional rules, или достаточно versioned projection schema?
10. **OPEN_QUESTION:** exact Rule ID для visibility rules отсутствуют в видимом фрагменте confirmed rules; нужно подтвердить registry перед добавлением ссылок в код.
11. **OPEN_QUESTION:** нужно ли version negotiation для REST response envelopes (`GET snapshot`, errors), или достаточно URL major + content negotiation header?
12. **OPEN_QUESTION:** какой код ошибки и safeMessage окончательно закрепить для unsupported contract version, с учётом требования не раскрывать скрытые причины?

## 9. Acceptance checks

### Schema и registry

- [ ] Для каждого command type существует registry с `commandVersion`, request schema, response/error policy и статусом lifecycle.
- [ ] Для каждого event type существует registry с immutable `eventVersion`, payload schema, visibility projection и adapter/up-converter.
- [ ] Command/event/snapshot schemas валидируют unknown fields согласно выбранной capability policy.
- [ ] Нельзя зарегистрировать новую breaking schema под старой version.
- [ ] Canonical event names согласованы и aliases покрыты migration tests.

### Compatibility

- [ ] Старый Player/TV/GM клиент получает только выбранную им schema/event version или безопасный `UNSUPPORTED_CONTRACT_VERSION`.
- [ ] Новый клиент корректно fallback-ится на baseline v1, если это разрешено capabilities.
- [ ] Старый command не меняет state при неизвестной/неподдержанной версии.
- [ ] Retry того же `requestId` с тем же payload/version идемпотентен; с другим payload/version не мутирует state.
- [ ] Event adapter v2→v1 не раскрывает поля, запрещённые роли v1.

### Visibility/security

- [ ] Каждая schema field имеет visibility annotation и тесты для TV, owner Player, other Player, GM и AI где применимо.
- [ ] Unknown field/unknown visibility condition не сериализуется в Player/TV/AI.
- [ ] Capability negotiation, errors, reconnect и migration failures не раскрывают seed, exact target, GM lore, чужие карты или checkpoint id.
- [ ] `conditional` fields не становятся public из-за adapter/default.

### Persistence/replay/rollback

- [ ] Каждый event journal row сохраняет immutable event version, ruleset version, sequence и seed по применимости.
- [ ] Checkpoint сохраняет snapshot schema version, ruleset version, last event sequence и seed state.
- [ ] Up-converter старого event/snapshot deterministic и имеет golden fixtures.
- [ ] Неподдержанный snapshot/event останавливает replay до state mutation.
- [ ] Rollback создаёт новый revision и audit row, не удаляет journal и не выдаёт reward повторно.
- [ ] Vertical slice проходит headless, reconnect, replay и rollback на baseline contract versions.

### API/operational

- [ ] `/api/v1` поведение задокументировано отдельно от schema/ruleset versions.
- [ ] Rolling deploy проверен с каждой поддерживаемой парой client/server versions.
- [ ] Migration tool dry-run показывает source/target/count/errors и не выполняет destructive changes без явного подтверждения.
- [ ] Контрактные тесты запускаются вместе с schema/API изменениями.

## 10. Файлы, которые придётся изменить для реализации

Текущий отчёт — единственный изменённый файл. Для будущей реализации потребуется отдельный task/ADR и, вероятно, следующие файлы:

1. `packages/contracts/command.schema.json` — добавить protocol/schema/command version и, при необходимости, capability/unsupported-version error schema.
2. `packages/contracts/event.schema.json` — добавить согласованные protocol/schema metadata; сохранить immutable `eventVersion`.
3. `packages/contracts/intent.schema.json` — только если registry закрепит versioned intent template semantics; gameplay поля без Decision Record не менять.
4. `packages/contracts/visibility.schema.json` — только если будет утверждён отдельный visibility/condition version; иначе оставить schema и добавить registry/tests.
5. `docs/03-system-contracts.md` — описать negotiation, canonical registry, adapters и snapshot envelope.
6. `docs/08-api-specification.md` — описать HTTP/WebSocket capabilities, join negotiation и unsupported-version error.
7. `docs/09-database-schema.md` — добавить snapshot schema metadata, persisted command/event contract metadata и migration audit.
8. `docs/04-visibility-matrix.md` — зафиксировать version-aware projection/redaction rules и unknown-field default.
9. `docs/05-vertical-slice.md` — добавить contract compatibility/replay/rollback acceptance checks, не меняя gameplay scope.
10. `docs/02-confirmed-rules.md` — только через ADR добавить новый `CONTRACT-*` namespace/rules; существующие Rule ID не переименовывать.
11. `server/contracts/` или эквивалентный source registry — canonical command/event/snapshot registry и converters (точный путь **OPEN_QUESTION**, так как в переданных документах не указан).
12. `server/projections/` — version-aware serializers/adapters с field-level visibility tests (точный путь **OPEN_QUESTION**).
13. `server/migrations/` и database migration files — additive columns/indexes для versions и migration audit; destructive migration запрещена без review.
14. `tests/contracts/`, `tests/replay/`, `tests/visibility/`, `tests/e2e/` — schema, compatibility, adapter, reconnect, replay, rollback и negative visibility tests.
15. Клиентские packages TV/Player/GM — capability negotiation, fallback и безопасный экран unsupported version (точные пути **OPEN_QUESTION**).

## 11. Итоговая рекомендация

Зафиксировать текущие контракты как baseline v1, но не считать их полноценной policy версионирования. Первым implementation step сделать ADR и canonical registry, затем добавить явное разделение protocol/schema/type/ruleset versions, capability negotiation и immutable event/snapshot migration. До закрытия OPEN_QUESTION нельзя безопасно объявлять backward compatibility для rolling deploy или менять event names. Эта policy сохраняет server authority, idempotency, field-level visibility, deterministic replay и `SAVE-002` rollback, не вводя новых gameplay rules.
