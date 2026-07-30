# Resolve — v0 "Core Tickets"

Course project for **The AI-Native Engineering Playbook** (ACA).
This is the official reference implementation of v0 — **NestJS +
PostgreSQL (TypeORM) + Docker** — matching PROJECT_BRIEF.md exactly.
If your stack is C#, Python, Go, Java, etc.: port this behavior to your
stack; the brief is the contract, this repo is a working example of it.

## Run (Docker — recommended)

```bash
docker compose up -d --build     # Postgres 16 + the app
curl localhost:3000/stats
```

Port 3000 busy? `APP_PORT=3300 docker compose up -d --build`.
Config is env-driven with sane defaults — `cp .env.example .env` to
override ports or database credentials (never commit `.env`).
Data lives in the `pgdata` volume — it survives restarts and rebuilds.
Reset everything: `docker compose down -v`.

## Run (local dev)

```bash
docker compose up -d db          # just the database
npm install
npm start                        # ts-node, listens on :3000 (PORT to change)
```

## Test

```bash
npm test                         # 14 tests, no database needed
```

Tests run against **in-memory SQLite**; runtime uses PostgreSQL. The
entities stick to dialect-neutral column types (dates as ISO strings) so
both behave identically.

## Endpoints (v0)

- `POST /tickets` — `{ subject, description, customerEmail, priority }`
  (priority: `low | normal | high | urgent`)
- `GET /tickets?status=&priority=` — list (filterable)
- `GET /tickets/:id` — one ticket, including comments
- `POST /tickets/:id/status` — `{ "to": "open" | ... }` (whitelisted
  transitions; illegal moves → 400 listing allowed next states)
- `POST /tickets/:id/comments` — `{ author, body, internal }`
  (`internal: true` = agent-only note; never expose to customers)
- `GET /audit` — every mutation, with actor (from `X-Actor` header)
- `GET /stats` — counts by status/priority + average resolution minutes

## Status machine

```
new → open → in_progress → resolved → closed
              ↑        ↓
           waiting_customer
```

## Conventions in this codebase

- Services never touch the TypeORM DataSource directly — data access goes
  through the module's repository (`TicketsRepository`, `AuditService`).
- Every mutation writes an audit entry: `AuditService.record(actor,
  action, ticketId, details)`; action names are `entity.verb`
  (`ticket.created`, `ticket.status_changed`).
- Validation errors are `BadRequestException` with the offending field
  named; controllers stay thin.
- Tests use the real service + repository over in-memory SQLite — no
  mocks of our own code.
- `synchronize: true` is a v0 convenience — migrations replace it in a
  later class.

## What comes next (don't build ahead)

Class 3: context kit + tags/canned responses · Class 4: the SLA engine
(spec-driven) · Class 5: review gates + the triage agent · Class 6: SLA
watchdog + self-healing CI · Class 7: chatbot (RAG), MCP, security
hardening · Class 8: capstone.
