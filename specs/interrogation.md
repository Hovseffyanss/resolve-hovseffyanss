
AC-4 — "adds a public comment... whose author is the X-Actor header." The rest of the codebase treats actor (audit actor, from X-Actor) and author (comment byline, a body field) as distinct concepts — see tickets.service.ts:107, where addComment requires its own input.author. AC-4 collapses them into one value.
- Reading A: the handler builds a TicketComment directly, setting comment.author = actor — bypassing addComment()'s author validation entirely.
- Reading B: the handler calls addComment(actor, id, { author: actor, body: ..., internal: false }), routing through existing validation (so an X-Actor:  — empty string — header would now fail "author must be a non-empty string", a new failure mode nothing in AC-4/AC-6 describes).

AC-16 vs. reused code — "recorded instead of ticket.commented... one mutation, one audit entry." addComment() unconditionally writes ticket.commented. To satisfy AC-16 the canned-response path can't just call addComment() unmodified.
- Reading A: duplicate the comment-creation logic in a new method that calls audit.record(..., 'ticket.canned_response_applied', ...) instead.
- Reading B: refactor addComment() to accept an optional action-name override, and have both callers share it.
Spec is silent on which; picking wrong either duplicates logic the reviewer will flag, or reshapes a method the spec never asked to touch.

AC-6 — "rejects a missing or non-string cannedResponseId with 400 naming the field." Unlike AC-2 (which explicitly covers "missing, not a string, or empty after trim"), AC-6 says nothing about an empty string.
- Reading A: follow the codebase's uniform "non-empty string" convention, so "" also 400s.
- Reading B: take AC-6 literally — "" is a string, so it passes validation and falls through to AC-5's 404 ("canned response '' not found").
These produce different status codes for the same input.

AC-7 / AC-11 response shape — "Responds with the ticket's full tag list" / "Responds with the remaining tag list."
- Reading A: bare string[].
- Reading B: { tags: string[] }, matching the wrapped-envelope style used elsewhere (Page<T>).
- Reading C: the full updated Ticket object, matching how changeStatus and addComment's sibling endpoints return full resources.

AC-9 status code vs. AC-7 status code — AC-9 explicitly pins the no-op duplicate-add case to "200." Every other creating POST in this codebase (ticket create, comments, presumably canned-responses) gets Nest's default 201, unstated in the spec because it's never overridden. AC-7 (the case where a new tag is actually added) never states a status code at all.
- Reading A: the endpoint is uniformly @HttpCode(200) for both the new-tag and duplicate-tag case (AC-9's "200" is just naming what the shared code path already does).
- Reading B: AC-7 is left at Nest's default 201 (new tag added = created), and only the AC-9 no-op branch is special-cased to 200 — same endpoint, two status codes depending on outcome.

Missing edges

AC-7 / AC-11 — unknown ticket id. AC-5 explicitly specifies 404 behavior (and which-entity-not-found messaging) for apply-canned-response on both an unknown ticket and an unknown canned response. Nothing analogous exists for the tag endpoints: AC-11 only defines 404 for "tag the ticket does not have," never for "ticket doesn't exist at all." An implementer could ship tag add/remove with no findById-or-404 guard and every AC as written would still be satisfiable on the happy path.

AC-13/AC-14 — repeated ?tag= query param. Non-goals excludes multi-tag filtering by design, but doesn't say what happens if a client sends ?tag=a&tag=b anyway. Nest/Express will bind @Query('tag') to a string[] in that case, not a string — AC-8's regex test (^[a-z0-9-]+$) run against an array is undefined behavior, not specified as a 400 or as "use the first value."

AC-3 — tie-breaking for "oldest-first." Open Question #1 debates the tag entity's key shape but says nothing about the canned-response entity needing a seq column. TicketComment and AuditEntry both use seq specifically because ISO-string createdAt at millisecond resolution collides under fast test execution. AC-3's ordering guarantee has no documented tiebreaker field to rely on.

AC-2/AC-1 — no upper bound on body length. Tags get an explicit 1–30 cap (AC-8); canned response title/body get none, despite body being copied verbatim into a ticket comment on every application (AC-4).

Undefined transitions

Tag mutations vs. updatedAt. TicketsRepository.save() unconditionally stamps ticket.updatedAt = new Date().toISOString() on every save. AC-9 says a duplicate-tag add "leaves the tag list unchanged" — but does "unchanged" extend to updatedAt? If the implementation calls tickets.save(ticket) as part of a no-op tag add (e.g. for code-path simplicity), the timestamp still moves even though AC-9 implies nothing changed. Not addressed either way.

Tags/canned-response application vs. ticket status machine. Open Question #5 flags this explicitly for apply-canned-response on closed tickets, but the exact same question exists for tag add/remove and is never even raised there. Nothing says whether tagging a closed ticket is allowed.

canned_response.created vs. ticket-scoped audit listing. GET /tickets/:id/audit and AuditService.list(ticketId) are both keyed on a real ticket id. A canned response isn't attached to any ticket, so wherever its audit entry ends up, it's structurally invisible to the one audit-reading endpoint the ticket domain exposes — the spec never says where a caller is supposed to find it.

Contradictions

AC-15 (canned_response.created) vs. the frozen audit schema. AuditService.record(actor, action, ticketId, details) takes a required ticketId: string, and AuditEntry.ticketId (src/audit/audit-entry.entity.ts) is a non-nullable varchar column with no default. Creating a canned response (AC-1) has no ticket in scope at all. There is no value that legitimately satisfies that parameter:
- Reading A: pass the canned response's own id (cr_xxxxxxxx) as ticketId — silently repurposing a column whose name and every other caller in the codebase means "ticket id," and polluting GET /audit?ticketId= semantics.
- Reading B: pass '' or a sentinel — same problem, plus risks passing SQLite's lenient typing (tests) while behaving differently under Postgres NOT NULL enforcement (runtime) — exactly the dialect divergence the Constraints section warns against.
- Reading C: this is precisely the case the spec's own Constraints section anticipates — "if this feature appears to need a change [to src/audit/], stop and say so; do not design around it silently" — meaning AC-15's first bullet may not be satisfiable as specified without a human decision, contradicting the instruction to just implement the AC.

Untestable ACs

Invariant 2 ("later changes to the canned response never alter comments already created from it") is unfalsifiable in v1: Non-goals explicitly excludes editing/deleting canned responses, so there is no code path that could mutate a canned response's body after creation. A test can't drive the one state transition the invariant is protecting against.

AC-3's "oldest-first" ordering, per the missing-edge note above — without a documented tiebreaker column, a test that creates two canned responses in immediate succession (typical in an in-memory SQLite suite) cannot reliably assert order; the AC's guarantee and the entity's actual fields (as specified) don't obviously support each other.

---
Top 3 gaps most likely to cause a wrong implementation:

1. AC-15's canned_response.created entry has no ticket to attach to, but the frozen AuditEntry.ticketId column is required and non-nullable — the most likely path to a silent, dialect-fragile workaround (or a runtime crash under Postgres that never shows up against SQLite tests) exactly where the spec itself says to stop and ask a human instead of routing around it.
2. AC-16 requires suppressing ticket.commented in favor of ticket.canned_response_applied, but the only existing comment-creation path (addComment()) always writes ticket.commented. Reusing that method naively — the path of least resistance — silently produces two audit entries and violates AC-16 while every other observable behavior looks correct.
3. No 404 requirement is stated for an unknown ticket id on the tag endpoints (AC-7/AC-11), unlike the explicit AC-5 for canned responses. It's easy to ship tag add/remove without a findById guard and have every literal AC still pass.