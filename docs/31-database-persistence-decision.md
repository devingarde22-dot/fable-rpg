# DR-INFRA-001 — SQLite for the active vertical slice

**Status:** ACCEPTED  
**Date:** 2026-10-29  
**Applies to:** `@fable/vertical-slice` and the initial single-process playable deployment

## Context

The current `main` baseline is `df627f6` (PR #23). PR #22 added `SqliteSlicePersistence` using Node's built-in `node:sqlite` / `DatabaseSync`, and crash-recovery integration tests. The active vertical-slice package does not depend on Drizzle ORM. The older `dev/database/schema.ts` imports Drizzle's PostgreSQL schema helpers, but it belongs to the obsolete `dev/` scaffold rather than the active runtime.

The active SQLite implementation persists session-resume records, runtime snapshots, command receipts, and domain-event records. It enables durable recovery when constructed with a file path. Its constructor defaults to `:memory:`, which is appropriate for ephemeral/test use and is not disk durability.

## Decision

**SQLite is the selected persistence engine for the current vertical slice and the first single-process/single-node playable deployment. It is not merely a disposable mock.**

- Use `SqliteSlicePersistence` for durable local persistence when a persistent database file is configured.
- Keep `InMemorySlicePersistence` and SQLite's `:memory:` mode for tests and ephemeral development.
- Do not introduce PostgreSQL or Drizzle into the active runtime just to match the old database-schema document.
- PostgreSQL remains a possible future migration target, not the current implementation or a committed production architecture.
- Revisit the database choice before adopting horizontal scaling/multiple active server instances, multi-writer access across processes, a managed shared database requirement, or an operational requirement that SQLite cannot reasonably meet. Make that change through a new decision and a migration/recovery plan, not through an incidental refactor.

This decision chooses the database for the current deployment shape; it does not claim the SQLite adapter is already production-hardened for every hosting environment.

## Consequences and guardrails

1. The active runtime uses Node's built-in `node:sqlite` and synchronous `DatabaseSync`; no ORM is currently used by `@fable/vertical-slice`.
2. A durable deployment must configure an explicit file path on storage that survives process restarts, preserve appropriate file permissions, and plan backup/restore. WAL creates SQLite sidecar files that must be handled by the chosen operational process.
3. The current adapter is designed around one active server process. Do not assume that a local SQLite file is suitable for multiple independently running application replicas.
4. `docs/09-database-schema.md` is retained as a **future relational campaign/lore target design**, not as the schema currently created by the active application. Its PostgreSQL/Drizzle tables and transaction sketches are not implemented by the active runtime.
5. `dev/database/schema.ts` remains an obsolete scaffold and must not be treated as the active persistence layer.
6. Before expanding the SQLite schema, add explicit schema-version/migration handling and review crash consistency across snapshots, command receipts, and event appends.
7. **Follow-up to verify:** the SQLite table currently declares `command_requests.request_id` as its primary key, while the older contract/documentation describes idempotency scoped by `(session_id, actor_id, request_id)`. Confirm the intended scope and align implementation, tests, and contract before relying on cross-session request-ID reuse.

## Review triggers

Revisit this decision when:
- more than one application process must write the same authoritative state;
- the hosting target cannot provide a reliable persistent local volume and backup process;
- measured write contention or operational recovery requirements exceed the SQLite design;
- the product requires a shared managed database or horizontal scaling.

Until then, SQLite is the active choice; PostgreSQL/Drizzle remains an explicitly unselected future option.
