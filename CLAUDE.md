# CLAUDE.md

"Resolve" — a support-ticket API. NestJS + PostgreSQL (TypeORM) + Docker.
Course reference implementation for The AI-Native Engineering Playbook.

How to run, build, and debug: `docs/running.md`.
Working in `src/tickets/`? `src/tickets/CLAUDE.md` loads with it.

## Layering is strict, and tests depend on it

`Controller` (thin — parses the request, calls the service) → `Service`
(validation + business rules) → `Repository` (the only thing touching a
TypeORM `Repository<Entity>`).

Services never inject `DataSource` or a raw TypeORM repository. Always go
through the module's own repository class. This is what lets tests swap
Postgres for in-memory SQLite: the module graph is rebuilt with the same
service/repository providers over `better-sqlite3`.

## `src/audit/` is frozen

`.claude/hooks/protect-audit.js` runs as a `PreToolUse` hook and blocks any
edit whose path contains `src/audit/`. This is enforced mechanically, not by
convention.

If a task needs `AuditService` to change, **say so and stop**. Do not design
around it silently. That has already happened once — see E-1 in
`specs/canned-responses-tags.md`.

Every mutation writes exactly one audit entry:
`AuditService.record(actor, action, ticketId, details)`, action named
`entity.verb` (`ticket.created`, `ticket.status_changed`, `ticket.tagged`).
`ticketId` is required and non-nullable, so anything without a ticket in
scope cannot be audited today.

## Both dialects, always

Tests run on in-memory better-sqlite3; production runs PostgreSQL. Entities
use dialect-neutral column types and dates are ISO strings.

No Postgres-only types or SQL. Equally: **SQLite passing is not proof.** It
is case-insensitive about identifiers and lenient about nulls, so raw SQL
must quote mixed-case identifiers (`tt."ticketId"`) and non-nullable columns
must be respected even where SQLite would let them slide.

## Conventions

- Validation failures throw `BadRequestException` naming the offending field
  (`"customerEmail must be a valid email address"`). Controllers don't validate.
- Actor identity comes from the `X-Actor` header (default `'api'`), read via
  `@Headers('x-actor')` and threaded through to `audit.record`.
- Entity primary keys are prefixed random strings from `newId(prefix)` in
  `src/common/ids.ts` (`tkt_`, `cmt_`, `cr_`). Internal `seq` auto-increment
  columns exist only for stable ordering, separate from the public `id`.
- Pagination is offset-based and shared: `parseOffsetPagination`, `Page<T>`,
  default 50 / max 200, in `src/common/pagination.ts`. Paginated endpoints all
  return `{ items, total, limit, offset }`. Do not invent a second mechanism.
- Tests exercise the real service and repository over in-memory SQLite. No
  mocking of this repo's own code.
- Write tests that could actually fail. A test that still passes when a
  constant changes is not a test.

`/feature` runs the full loop for new work: explore → plan → implement →
test → summary.
