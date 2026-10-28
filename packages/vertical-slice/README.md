# Fable player/GM vertical slice

`@fable/vertical-slice` — минимальный in-memory adapter поверх `@fable/rules`. Он показывает полный серверный поток без UI и внешней сети:

```text
player command → role check → HeadlessSimulationEngine → domain events → role-filtered projection
GM command     → role check → pause/outcome control → projections
```

## Что входит

- два player actor (`player-1`, `player-2`) и один GM;
- authoritative `HeadlessSimulationEngine`;
- player projection с собственным hero и enemy entities;
- GM projection со всеми entities и active intents;
- `player.move` через реальный 250 ms input window;
- GM pause/resume;
- GM expedition outcome;
- event broadcast и command result;
- integration tests на role checks, visibility, movement, pause и outcome.

## Локальная проверка

Из корня monorepo:

```bash
pnpm --filter @fable/vertical-slice test
pnpm check
pnpm build
```

## Сознательные ограничения

Это не production transport и не UI. Нет авторизации, WebSocket/Colyseus wiring, persistence, reconnect, rate limiting или schema validation внешнего сообщения. Следующим шагом можно заменить in-memory `SliceConnection` на transport adapter, не перенося gameplay-логику из `HeadlessSimulationEngine`.
