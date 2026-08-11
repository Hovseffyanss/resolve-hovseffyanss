# Spec — Canned Responses & Ticket Tags (v1)

Status: draft, pre-interrogation
Owner: lusine

Two related additions to Resolve: reusable canned responses an agent can
apply to a ticket as a comment, and lowercase tags for categorising and
filtering tickets.

---

## Acceptance criteria

Each AC has an id. Every test must name the AC id it covers.

### Canned responses

**AC-1** `POST /canned-responses` creates a canned response.
Body: `{ title, body }`. Responds with `{ id, title, body, createdAt }`.
`id` is `newId('cr')` — e.g. `cr_a1b2c3d4`.

**AC-2** `POST /canned-responses` rejects invalid input with 400, naming the
offending field:
- `title` missing, not a string, or empty after trim → `"title must be a non-empty string"`
- `body` missing, not a string, or empty after trim → `"body must be a non-empty string"`

**AC-3** `GET /canned-responses` lists canned responses oldest-first, using the
existing offset pagination (`?limit=`, `?offset=`) and returning the standard
`Page<T>` envelope `{ items, total, limit, offset }`.

**AC-4** `POST /tickets/:id/apply-canned-response` with body
`{ cannedResponseId }` adds a **public** comment (`internal: false`) to the
ticket whose `body` is a verbatim copy of the canned response's `body` at the
time of application, and whose `author` is the `X-Actor` header (default
`'api'`). Responds with the created comment.

**AC-5** `POST /tickets/:id/apply-canned-response` returns 404 when the ticket
id is unknown, and 404 when the canned response id is unknown. The message
names which one was not found.

**AC-6** `POST /tickets/:id/apply-canned-response` rejects a missing or
non-string `cannedResponseId` with 400 naming the field.

### Tags

**AC-7** `POST /tickets/:id/tags` with body `{ tag }` adds a tag to the ticket.
The tag is normalised before storage: trimmed, then lowercased.
Responds with the ticket's full tag list after the change.

**AC-8** Tag values are validated after normalisation. A tag must be 1–30
characters and match `^[a-z0-9-]+$`. Anything else → 400 naming the field
(e.g. `"tag must contain only lowercase letters, digits and hyphens"`).

**AC-9** Tags are deduplicated per ticket. Adding a tag the ticket already has
succeeds (200) and leaves the tag list unchanged. It writes **no** audit entry,
because nothing changed.

**AC-10** A ticket may hold at most **10** tags. Adding an 11th distinct tag
→ 400 `"ticket cannot have more than 10 tags"`. The ticket is left unchanged.

**AC-11** `DELETE /tickets/:id/tags/:tag` removes a tag. The path value is
normalised the same way as AC-7 before matching. Responds with the remaining
tag list. Removing a tag the ticket does not have → 404.

**AC-12** Tickets expose their tags. `GET /tickets/:id` and every item in
`GET /tickets` include a `tags` array, sorted alphabetically.

**AC-13** `GET /tickets?tag=` filters to tickets carrying that tag, after the
same normalisation as AC-7. It combines with the existing `status` and
`priority` filters (all applied together, AND), and filtering happens **before**
pagination, so `total` reflects the filtered set.

**AC-14** A `?tag=` value that fails AC-8 validation → 400. An unknown but
well-formed tag returns an empty page, not an error.

### Audit

**AC-15** Every mutation writes one audit entry via `AuditService.record`,
using `entity.verb` action names:
- `canned_response.created` — details `{ title }`
- `ticket.canned_response_applied` — details `{ cannedResponseId, commentId }`
- `ticket.tagged` — details `{ tag }`
- `ticket.untagged` — details `{ tag }`

The actor is the `X-Actor` header in all cases.

**AC-16** `ticket.canned_response_applied` is recorded **instead of**
`ticket.commented` when a comment originates from a canned response — one
mutation, one audit entry.

---

## Invariants

1. A ticket's tags are unique, lowercase, and number at most 10 — at every
   point in time, not merely at the moment of writing.
2. Applying a canned response copies its body. Later changes to the canned
   response never alter comments already created from it.
3. The audit trail is append-only. Nothing in this feature updates or deletes
   an audit entry.
4. Comments created by AC-4 are public. This feature never produces an
   internal comment.
5. Tag ordering is not meaningful. Any endpoint returning tags returns them
   sorted alphabetically so responses are deterministic.

---

## Constraints

- **Layering**: controllers stay thin; all data access goes through a
  repository class; services never touch `DataSource` or a raw TypeORM
  repository.
- **`src/audit/` is frozen** — enforced by `.claude/hooks/protect-audit.js`.
  If this feature appears to need a change there, stop and say so; do not
  design around it silently.
- **Dialect-neutral only**: entities must work on both Postgres (runtime) and
  in-memory SQLite (tests). Dates are ISO strings. No Postgres-only column
  types, no array columns, no JSON operators in queries.
- **Tags are stored in their own table** (a row per ticket/tag pair), not as a
  serialised column, so AC-13 can filter in SQL.
- **Pagination** reuses `src/common/pagination.ts` (`parseOffsetPagination`,
  `Page<T>`, default 50, max 200). No new pagination mechanism.
- **Ids** come from `newId(prefix)` in `src/common/ids.ts`.
- **Validation failures** are `BadRequestException` naming the offending field.
- Tests run without a database, against in-memory SQLite, exercising the real
  service and repository. No mocking of our own code.

---

## Non-goals

Explicitly out of scope for v1. Do not build these:

- Editing or deleting canned responses (create and list only).
- Variable substitution or templating in canned response bodies
  (`{{customerName}}` and similar).
- Tag rename, merge, or a global "list all tags in use" endpoint.
- Multi-tag filtering (`?tag=a&tag=b`), tag exclusion, or boolean tag queries.
- Setting tags at ticket creation time.
- Tag autocomplete or usage counts.
- Any permissions model — `X-Actor` remains an unverified header.
- Migrations. `synchronize: true` still creates the new tables.

---

## Open questions

Decisions I am deliberately leaving to the implementer, or deferring. Flagged
here rather than left silently ambiguous:

1. **Tag entity shape.** A `ticket_tags` table is required, but whether it has
   a surrogate `seq` primary key (like `TicketComment`) or a composite
   `(ticketId, tag)` key is the implementer's call.
2. **Removing a tag that is absent** is specified as 404 (AC-11). An idempotent
   204 is equally defensible; I chose 404 for symmetry with every other
   `:id`-shaped lookup in this codebase. Open to being overruled in review.
3. **Whether `GET /canned-responses` should be paginated at all** — v1 says yes
   for consistency with `GET /tickets`, but the expected row count is small.
4. **Empty `?tag=`** (`/tickets?tag=`) — currently falls under AC-14's
   validation and 400s. Treating it as "no tag filter" is also reasonable.
5. **Whether applying a canned response should be blocked on closed tickets.**
   v1 does not restrict it. Commenting is not restricted today either, so this
   would be a new rule, and it is a support-policy question rather than an
   engineering one.



