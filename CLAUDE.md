# CLAUDE.md

"Resolve" — a support-ticket API (tickets, comments, tags, canned responses,
an append-only audit trail, and stats). NestJS + PostgreSQL (TypeORM) +
Docker. Course reference implementation for The AI-Native Engineering
Playbook; solo repo, `main` deploys on every push.

Running, building, debugging: `docs/running.md`.
Working in `src/tickets/`? `src/tickets/CLAUDE.md` loads with it.

## Architecture

Module-per-domain under `src/`: `tickets`, `canned-responses`, `audit`,
`stats`, `health` — each with its own `.module.ts` — plus shared helpers in
`src/common/` (`ids.ts`, `pagination.ts`).

`Controller` (thin — parses the request, calls the service) → `Service`
(validation + business rules) → `Repository` (the only thing touching a
TypeORM `Repository<Entity>`). Services MUST NOT inject `DataSource` or a raw
TypeORM repository, because tests rebuild the module graph over in-memory
SQLite with the same providers — a service that reaches past its repository
can't be tested without a real Postgres.

## `src/audit/` is frozen

`.claude/hooks/protect-audit.js` blocks any edit whose path contains
`src/audit/`. Enforced mechanically, not by convention.

If a task needs `AuditService` to change, **say so and stop**, because an
agent that can rewrite the audit trail can hide what it did. Do not design
around it silently — that has already happened once (see E-1 in
`specs/canned-responses-tags.md`).

Every mutation writes exactly one entry:
`AuditService.record(actor, action, ticketId, details)`, action named
`entity.verb`. `ticketId` is required and non-nullable, so anything without a
ticket in scope cannot be audited today.

## Conventions

- Validation failures MUST throw `BadRequestException` naming the offending
  field (`"customerEmail must be a valid email address"`), because a caller
  has to know which field to fix without reading our source.
- Controllers MUST NOT validate, because validation that lives in two layers
  drifts, and only the service layer is covered by tests.
- Entity ids come from `newId(prefix)` in `src/common/ids.ts` (`tkt_`, `cmt_`,
  `cr_`), because ids appear in audit entries and logs, and the prefix says
  what you're looking at without a lookup.
- Paginated endpoints MUST use `parseOffsetPagination` and `Page<T>` from
  `src/common/pagination.ts` and return `{ items, total, limit, offset }`,
  because a second pagination mechanism means two sets of edge cases and two
  sets of bugs.
- Actor identity comes from the `X-Actor` header (default `'api'`), read via
  `@Headers('x-actor')` and threaded to `audit.record`.

## Both dialects, always

Tests run on in-memory better-sqlite3; production runs PostgreSQL. Entities
use dialect-neutral column types; dates are ISO strings.

**SQLite passing is not proof.** It is case-insensitive about identifiers and
lenient about nulls, so raw SQL MUST quote mixed-case identifiers and
non-nullable columns MUST be respected — Postgres fails at runtime on queries
the whole suite accepted.

## Testing

- Tests exercise the real service and repository over in-memory SQLite. No
  mocking of this repo's own code, because a mock of our own wiring passes
  while the wiring is broken.
- Spec-driven work names its AC id in the test name (`it('AC-9: ...')`),
  because coverage then becomes `grep`, not a judgement call.
- Write tests that could actually fail. A test that still passes when the
  constant changes is not coverage — cover rejection paths and edges, not
  just the happy path.
- Creating rows in a loop collides on millisecond `createdAt`. Freeze time
  with fake timers when asserting order.

## Negative space — do not copy these

Real patterns in this repo that look intentional and are not:

- **`listAudit` reversing in memory** (`tickets.service.ts`) — a workaround
  because `src/audit/` is frozen, not a sorting pattern. Sort in the query.
- **`TicketsRepository.tagRepo` being `@Optional()` with a `tags: []`
  fallback** — accepted debt (D-1), forced by a frozen test. New repository
  dependencies are required, not optional; silent empty results hide bugs.
- **`synchronize: true`** — a v0 convenience. Do not treat it as the schema
  workflow, and do not add columns expecting it to survive migrations later.
- **`X-Actor` as identity** — an unverified header. Never use it for
  authorization or to gate behavior.
- **`seq` appearing in responses** — accepted debt (D-2), not a decision to
  imitate.
- **`GET /audit` being unpaginated** — predates the pagination convention.
  New list endpoints paginate.
- **`tickets.service.spec.ts`'s test module** — predates `TicketTag` and does
  not register it. Do not copy it as the template for a new spec file.

`/feature` runs the full loop for new work: explore → plan → implement →
test → summary.
