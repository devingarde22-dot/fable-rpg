# Fable — Step B Reviews

**Статус:** historical review completed; implementation/status is superseded by current confirmed docs and Decision Records

Шесть независимых агентов проверили разные части Shared Contracts и JSON Schema. Эти отчёты являются историческим review-слоем, а не окончательной заменой confirmed-документов. Package boundary is fixed by DR-C-001; typed intent schema, active runtime scope and deterministic RNG are fixed by DR-C-002. Current work must follow the confirmed baseline, Step C specification, and those Decision Records—not treat the earlier synthesis proposal below as pending implementation work.

## Отчёты

1. [Entities](./01-entities.md) — канонические сущности, templates, runtime entities и projections.
2. [Commands](./02-commands.md) — command payloads, preconditions, idempotency и safe errors.
3. [Events](./03-events.md) — event envelope, ordering, replay и rollback metadata.
4. [Visibility](./04-visibility.md) — TV/Player/GM/AI projections и leakage risks.
5. [Versioning](./05-versioning.md) — protocol/schema/ruleset versions и compatibility.
6. [Fixtures](./06-fixtures.md) — valid/invalid fixtures, golden tests и acceptance matrix.

## Общие выводы

- Текущие `command.schema.json` и `event.schema.json` пока слишком generic: typed discriminated unions нужны до реализации server router.
- Нужно разделить `IntentTemplate` и `ActiveIntent`, а также `CardTemplate`, `CardInstance` и `DeckState`.
- Нужно разделить authoritative events и role-filtered transport projections.
- `seed`, exact target, fallback pool, draw pile и audit data никогда не должны уходить TV/Player/AI по умолчанию.
- Нужно согласовать `sceneId` для campaign/session events, canonical event names и semantics `gm.pause_scene`.
- Нужно зафиксировать wire shape rollback с `confirmationToken`, actorId semantics и protocol/schema/ruleset versioning.

## Текущий статус

Оставшиеся review observations do not become `CONFIRMED` automatically; consult the current baseline and applicable Decision Records for their status. The original proposal to synthesize the six reports and update schemas is historical and has been superseded for the decisions already recorded in DR-C-001/002.
