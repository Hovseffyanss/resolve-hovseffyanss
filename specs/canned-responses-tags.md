# Spec — Canned Responses & Ticket Tags (v1)

Status: v1.1 — revised after interrogation (see `specs/interrogation.md`)
Owner: lusine

Two related additions to Resolve: reusable canned responses an agent can
apply to a ticket as a comment, and lowercase tags for categorising and
filtering tickets.

---

## Acceptance criteria

Each AC has an id. Every test must name the AC id it covers.

### Canned responses

**AC-1** `POST /canned-responses` creates a canned response.
Body: `{ title, body }`. Responds **201** with `{ id, title, body, createdAt }`.
`id` is `newId('cr')` — e.g. `cr_a1b2c3d4`.

**AC-2** `POST /canned-responses` rejects invalid input with 400, naming the
offending field:
- `title` missing, not a string, or empty after trim → `"title must be a non-empty string"`
- `body` missing, not a string, or empty after trim → `"body must be a non-empty string"`
- `title` longer than 200 characters after trim → `"title must be at most 200 characters"`
- `body` longer than 5000 characters after trim → `"body must be at most 5000 characters"`

**AC-3** `GET /canned-responses` lists canned responses oldest-first, using the
existing offset pagination (`?limit=`, `?offset=`) and returning the standard
`Page<T>` envelope `{ items, total, limit, offset }`.
Ordering is by an auto-increment `seq` column ascending — **not** by
`createdAt`, whose millisecond ISO strings collide under fast test execution.
`seq` is internal and is not part of the response body.

**AC-4** `POST /tickets/:id/apply-canned-response` with body
`{ cannedResponseId }` adds a **public** comment (`internal: false`) to the
ticket whose `body` is a verbatim copy of the canned response's `body` at the
time of application. Responds **201** with the created comment.

The comment's `author` is the resolved actor: the `X-Actor` header, trimmed;
if the header is absent or empty after trimming, the actor is `'api'`. The
same resolved value is used as the audit actor, so `author` and `actor` are
always equal for canned-response comments. An empty `X-Actor` must **not**
produce an `"author must be a non-empty string"` error.

**AC-5** `POST /tickets/:id/apply-canned-response` returns 404 when the ticket
id is unknown (`"ticket <id> not found"`), and 404 when the canned response id
is unknown (`"canned response <id> not found"`).

**AC-6** `POST /tickets/:id/apply-canned-response` rejects a `cannedResponseId`
that is missing, not a string, or empty after trim with 400 naming the field.
An empty string is a 400, never a 404.

### Tags

**AC-7** `POST /tickets/:id/tags` with body `{ tag }` adds a tag to the ticket.
The tag is normalised before validation and storage: trimmed, then lowercased.
Responds **200** with the full updated ticket (which includes `tags`, per
AC-12). This endpoint returns 200, not 201, in every case — it mutates an
existing resource rather than creating an addressable one.

**AC-8** Tag values are validated after normalisation. A tag must be 1–30
characters and match `^[a-z0-9-]+$`. Anything else → 400 naming the field
(e.g. `"tag must contain only lowercase letters, digits and hyphens"`).
A missing or non-string `tag` → 400 `"tag must be a non-empty string"`.

**AC-9** Tags are deduplicated per ticket. Adding a tag the ticket already has
responds 200 with the ticket unchanged. It writes **no** audit entry and does
**not** advance the ticket's `updatedAt` — nothing changed, so nothing is
persisted.

**AC-10** A ticket may hold at most **10** tags. Adding an 11th distinct tag
→ 400 `"ticket cannot have more than 10 tags"`. The ticket is left unchanged
and no audit entry is written. Re-adding one of the existing 10 still succeeds
as a no-op under AC-9.

**AC-11** `DELETE /tickets/:id/tags/:tag` removes a tag. The path value is
normalised the same way as AC-7 before matching. Responds **200** with the full
updated ticket. Removing a tag the ticket does not have → 404
`"ticket <id> does not have tag '<tag>'"`.

**AC-12** Tickets expose their tags. `GET /tickets/:id` and every item in
`GET /tickets` include a `tags` array of strings, sorted alphabetically.
A ticket with no tags has `tags: []`, never `null` or a missing key.

**AC-13** `GET /tickets?tag=` filters to tickets carrying that tag, after the
same normalisation as AC-7. It combines with the existing `status` and
`priority` filters (all applied together, AND), and filtering happens **before**
pagination, so `total` reflects the filtered set.

**AC-14** A `?tag=` value that fails AC-8 validation → 400. An unknown but
well-formed tag returns an empty page (`items: []`, `total: 0`), not an error.
A repeated `?tag=a&tag=b` (which binds as an array) → 400
`"tag must be a single value"` — multi-tag filtering is a non-goal, and
silently using the first value would hide the client's mistake.

**AC-15** Tag endpoints validate the ticket exists first. `POST /tickets/:id/tags`
and `DELETE /tickets/:id/tags/:tag` return 404 `"ticket <id> not found"` for an
unknown ticket id, checked **before** tag validation — an unknown ticket with an
invalid tag is a 404, not a 400.

**AC-16** Tagging is allowed in every ticket status, including `closed`. No tag
operation consults or alters the status machine, and no tag operation changes
`status` or `resolvedAt`.

### Audit

**AC-17** Every mutation writes exactly one audit entry via
`AuditService.record`, using `entity.verb` action names:
- `ticket.canned_response_applied` — details `{ cannedResponseId, commentId }`
- `ticket.tagged` — details `{ tag }`
- `ticket.untagged` — details `{ tag }`

The actor is the resolved actor from AC-4 in all cases.

**AC-18** Applying a canned response writes `ticket.canned_response_applied`
and **not** `ticket.commented` — exactly one audit entry for the mutation, not
two. Since the existing `TicketsService.addComment` unconditionally records
`ticket.commented`, satisfying this requires changing how that path works.
Refactoring `addComment` so both callers share one comment-creation path with a
parameterised audit action is **explicitly permitted and preferred**;
duplicating the comment-creation logic into a second method is not acceptable.

**AC-19** Creating a canned response writes **no** audit entry in v1.
See *Escalations* below — this is a known gap, not an oversight.

---

## Invariants

1. A ticket's tags are unique, lowercase, and number at most 10 — at every
   point in time, not merely at the moment of writing.
2. The audit trail is append-only. Nothing in this feature updates or deletes
   an audit entry.
3. Comments created by AC-4 are public. This feature never produces an
   internal comment.
4. Tag ordering is not meaningful. Any endpoint returning tags returns them
   sorted alphabetically so responses are deterministic.
5. A no-op tag operation persists nothing: no row written, no `updatedAt`
   change, no audit entry.

### Design note (not an invariant — unfalsifiable in v1)

Applying a canned response copies its body, so later edits to the canned
response would not alter comments already created from it. This cannot be
tested in v1 because editing canned responses is a non-goal and no code path
can mutate a stored body. It is recorded here so the copy-not-reference
decision is deliberate rather than incidental.

---

## Constraints

- **Layering**: controllers stay thin; all data access goes through a
  repository class; services never touch `DataSource` or a raw TypeORM
  repository.
- **`src/audit/` is frozen** — enforced by `.claude/hooks/protect-audit.js`.
  If this feature appears to need a change there, stop and say so; do not
  design around it silently. (This already happened once — see *Escalations*.)
- **Dialect-neutral only**: entities must work on both Postgres (runtime) and
  in-memory SQLite (tests). Dates are ISO strings. No Postgres-only column
  types, no array columns, no JSON operators in queries.
- **Tags are stored in their own table** (a row per ticket/tag pair), not as a
  serialised column, so AC-13 can filter in SQL.
- **Pagination** reuses `src/common/pagination.ts` (`parseOffsetPagination`,
  `Page<T>`, default 50, max 200). No new pagination mechanism.
- **Ids** come from `newId(prefix)` in `src/common/ids.ts`. Entities needing
  stable ordering also carry an internal auto-increment `seq`, as
  `TicketComment` and `AuditEntry` already do.
- **Validation failures** are `BadRequestException` naming the offending field.
- Tests run without a database, against in-memory SQLite, exercising the real
  service and repository. No mocking of our own code.
- **The tests are frozen once written.** The implementation phase may not edit,
  delete, weaken, or skip any test written from these AC.

---

## Escalations — need a human decision

**E-1 — Canned-response creation cannot be audited under the current schema.**
`AuditService.record(actor, action, ticketId, details)` requires a `ticketId`,
and `AuditEntry.ticketId` is a non-nullable varchar. A canned response has no
ticket in scope. Every workaround is unacceptable: passing the `cr_` id
corrupts the meaning of the column and pollutes `GET /audit?ticketId=`, and a
sentinel like `''` passes SQLite in tests but violates `NOT NULL` on Postgres at
runtime — the exact dialect divergence the constraints forbid.

The correct fix is to make `ticketId` nullable (or add a subject/entity column)
in `src/audit/`, which is frozen and human-only. **v1 therefore does not audit
canned-response creation (AC-19), and this is flagged for a human rather than
worked around.** Do not attempt to satisfy this AC by any other means.

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

Decisions deliberately left to the implementer, or deferred. Flagged here
rather than left silently ambiguous:

1. **Tag entity shape.** A `ticket_tags` table is required, but whether it has
   a surrogate `seq` primary key (like `TicketComment`) or a composite
   `(ticketId, tag)` key is the implementer's call, provided invariant 1 holds.
2. **Removing a tag that is absent** is specified as 404 (AC-11). An idempotent
   204 is equally defensible; 404 was chosen for symmetry with every other
   `:id`-shaped lookup in this codebase. Open to being overruled in review.
3. **Whether `GET /canned-responses` should be paginated at all** — v1 says yes
   for consistency with `GET /tickets`, though the expected row count is small.
4. **Empty `?tag=`** (`/tickets?tag=`) — falls under AC-14 and 400s. Treating an
   empty value as "no tag filter" is also reasonable; not chosen because it
   makes a typo silently return everything.
5. **Whether applying a canned response should be blocked on closed tickets.**
   v1 does not restrict it (and AC-16 makes the same call for tags). Commenting
   is unrestricted today, so a restriction would be new policy — a
   support-operations question, not an engineering one.
