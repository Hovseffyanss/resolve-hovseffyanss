# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Resolve" — a course reference implementation ("Core Tickets", v0) for **The
AI-Native Engineering Playbook**. NestJS + PostgreSQL (TypeORM) + Docker. The
brief (`PROJECT_BRIEF.md`, if present) is the contract; this repo is a
working example of it. Deployed via CI on every push to `main`.

## Commands

```bash
npm start           # ts-node src/main.ts, listens on :3000 (PORT env to change)
npm run build        # tsc -> dist/
npm run start:prod    # node dist/main.js
npm test              # jest — 14 tests, no database needed
npm run test:watch
```

Run a single test file: `npx jest src/tickets/tickets.service.spec.ts`
Run by name: `npx jest -t "rejects invalid input"`

Local dev needs Postgres for the app itself, but **not** for tests:
```bash
docker compose up -d db     # just the database
npm install
npm start
```

Full stack via Docker:
```bash
docker compose up -d --build     # Postgres 16 + the app
curl localhost:3000/stats
```
Port 3000 busy? `APP_PORT=3300 docker compose up -d --build`. Config is
env-driven (`cp .env.example .env`); data lives in the `pgdata` volume
(`docker compose down -v` to reset).

Tests run against **in-memory better-sqlite3**; runtime uses PostgreSQL.
Entities stick to dialect-neutral column types (dates stored as ISO
strings) so both behave identically — do not introduce Postgres-only
column types or SQL.

## Architecture

Standard Nest module-per-domain layout: `src/{tickets,audit,stats,health}`,
each with its own `.module.ts`. `AppModule` (`src/app.module.ts`) wires
`TypeOrmModule.forRoot` (Postgres, `synchronize: true` — a v0 convenience,
not yet using migrations) plus the four feature modules.

**Layering is strict and load-bearing for tests:** `Controller` (thin,
parses request → calls service) → `Service` (validation + business rules)
→ `Repository` (the only thing touching the TypeORM `Repository<Entity>`).
Services never inject `DataSource` or a raw TypeORM repository directly —
always go through the module's own repository class (`TicketsRepository`,
etc.). This is what lets tests swap Postgres for in-memory SQLite
transparently (see `tickets.service.spec.ts`): the module graph is rebuilt
with a `better-sqlite3` `TypeOrmModule.forRoot` and the same
service/repository providers.

**Audit trail is append-only and hook-protected.** Every mutation calls
`AuditService.record(actor, action, ticketId, details)` with an
`entity.verb` action name (`ticket.created`, `ticket.status_changed`,
`ticket.commented`). `src/audit/` is frozen: `.claude/hooks/protect-audit.js`
runs as a `PreToolUse` hook on `Edit|Write|MultiEdit` and blocks (exit 2)
any edit whose path contains `src/audit/` — the policy is enforced
mechanically, not just by convention. If a task requires changing
`AuditService` itself (e.g. adding a DESC sort param), that has to be
called out to a human rather than routed around (see the workaround
comment in `tickets.service.ts::listAudit`, which reverses/slices in the
service instead of touching the frozen file).

**Actor identity** comes from the `X-Actor` request header (default
`'api'`), read via `@Headers('x-actor')` in controllers and threaded
through to `audit.record`.

**Ticket status machine** (`ALLOWED_TRANSITIONS` in `tickets.service.ts`):
```
new → open → in_progress → resolved → closed
              ↑        ↓
           waiting_customer
```
Illegal transitions throw `BadRequestException` listing the allowed next
states. `resolvedAt` is stamped only on the transition into `resolved`
(used by `/stats` for average resolution time).

**Pagination** is offset-based, shared via `src/common/pagination.ts`
(`parseOffsetPagination`, `Page<T>`, `DEFAULT_PAGE_LIMIT=50`,
`MAX_PAGE_LIMIT=200`). Endpoints returning paginated results respond with
the same `{ items, total, limit, offset }` envelope
(`GET /tickets`, `GET /tickets/:id/audit`). `GET /tickets/:id/audit` sorts
newest-first by reversing the ascending list `AuditService.list()` returns
(see above — that reversal lives outside `src/audit/` on purpose).

**IDs**: entity primary keys are prefixed random strings from
`newId(prefix)` in `src/common/ids.ts` (e.g. `tkt_xxxxxxxx`,
`cmt_xxxxxxxx`), not auto-increment integers or plain UUIDs. Internal
`seq` auto-increment columns exist on `TicketComment` and `AuditEntry`
purely for stable ordering, separate from the public `id`.

**Comments**: `internal: true` marks agent-only notes that must never be
exposed to customers — preserve that distinction if touching comment
serialization.

## Conventions

- Validation failures throw `BadRequestException` naming the offending
  field (e.g. `"customerEmail must be a valid email address"`) — controllers
  stay thin and don't validate.
- Tests exercise the real service + repository over in-memory SQLite; no
  mocking of this repo's own code (see `tickets.service.spec.ts`,
  `pagination.spec.ts`, `health.controller.spec.ts` for the pattern).
- Add tests that could actually fail (cover edge cases and rejection
  paths, not just the happy path) — see `.claude/commands/feature.md` for
  the fuller phase-by-phase workflow (`/feature`) this repo expects for
  new work: explore existing conventions → plan (flag ambiguous/API-level
  decisions instead of assuming) → implement → test → summarize
  assumptions made.

## What comes next (don't build ahead)

Class 3: context kit + tags/canned responses · Class 4: the SLA engine
(spec-driven) · Class 5: review gates + the triage agent · Class 6: SLA
watchdog + self-healing CI · Class 7: chatbot (RAG), MCP, security
hardening · Class 8: capstone.
