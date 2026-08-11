# Tickets module

Loaded only when working in `src/tickets/`.

## Status machine

`ALLOWED_TRANSITIONS` in `tickets.service.ts`:

```
new → open → in_progress → resolved → closed
              ↑        ↓
           waiting_customer
```

Illegal transitions throw `BadRequestException` listing the allowed next
states. `resolvedAt` is stamped only on the transition into `resolved`, and
`/stats` uses it for average resolution time — clear it if a ticket ever
leaves `resolved`.

## Comments

`internal: true` marks agent-only notes that must never reach customers.
Preserve that distinction if you touch comment serialization.

All comment creation goes through one path in `TicketsService`, with the
audit action passed in — `ticket.commented` normally,
`ticket.canned_response_applied` when the body came from a canned response.
One mutation writes exactly one audit entry. Do not add a second
comment-creation path.

## Tags

Stored one row per ticket/tag pair in `ticket_tags` (`TicketTag`), not as a
serialised column, so `?tag=` filters in SQL.

Normalised on the way in: trimmed, lowercased, `^[a-z0-9-]+$`, max 30 chars,
max 10 per ticket, deduplicated. Adding a tag that already exists is a no-op
that writes nothing — no row, no `updatedAt` bump, no audit entry.

The `?tag=` filter uses a raw `EXISTS` subquery in `TicketsRepository`.
`tt."ticketId"` **must stay double-quoted**: Postgres folds unquoted
identifiers to lowercase and the column is `"ticketId"`, so unquoted it
resolves to `tt.ticketid` and fails at runtime. SQLite is case-insensitive
and will not catch this in tests.

## Audit listing

`GET /tickets/:id/audit` returns newest-first by reversing the ascending list
`AuditService.list()` returns. That reversal lives here on purpose —
`src/audit/` is frozen, and the correct fix (a DESC option on
`AuditService.list()`) needs a human. See `listAudit`.
