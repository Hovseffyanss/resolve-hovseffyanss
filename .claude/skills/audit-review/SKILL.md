---
name: audit-review
description: Check the current diff for missing, duplicate, or misnamed audit trail entries — every ticket mutation in this repo must call AuditService.record exactly once with an entity.verb action name. Use before committing or opening a PR, or whenever asked to review audit logging, check audit coverage, or make sure a change is tracked.
allowed-tools: Bash(git diff:*), Bash(git status:*), Read, Grep, Glob
---

# Audit review

This repo's rule (see `CLAUDE.md`): every mutation writes exactly one audit
entry — `AuditService.record(actor, action, ticketId, details)`, action
named `entity.verb`. `src/audit/` itself is frozen; this skill only reads
and reports, it never edits there.

## What counts as a mutation

Any code path that creates, updates, or deletes a ticket-related row —
ticket creation, status changes, comments, tag add/remove, canned-response
application — reached through `TicketsService`, `CannedResponsesService`,
or their repositories.

## Procedure

1. Get the diff: `git diff` against `main` if the branch has diverged,
   otherwise the working tree's staged/unstaged changes. Say which you used.
2. For every changed or added method that writes via a repository, check:
   - Exactly one `audit.record(...)` call on that path — not zero, not two.
   - Action name follows `entity.verb` (e.g. `ticket.tagged`, not
     `tag.added`).
   - `ticketId` passed is a real ticket id in scope — never `null` or
     `undefined`.
   - `details` carries the fields a reader would need to reconstruct what
     happened, not just `{}`.
3. A mutation with no ticket in scope (e.g. creating a canned response)
   genuinely cannot be audited today — `AuditEntry.ticketId` is
   non-nullable. That's a known, already-escalated gap (see E-1 in
   `specs/canned-responses-tags.md`), not a new finding — note it
   separately, don't report it as a missing audit call.

## Output

```
## Diff reviewed
<base used, e.g. "main" or "working tree">

## Mutations checked
- <file>:<method> — <one line: what it does>

## Missing or wrong audit entries
- <file>:<line> — <what's wrong and what it should be>
(omit this heading if none)

## Already-escalated, not a new finding
- <file>:<method> — <which existing gap this matches>
(omit this heading if none)
```

## Prohibitions

- Do not edit anything under `src/audit/` — it is frozen.
- Do not add or fix a missing `audit.record` call yourself — flag it for a
  human to add, and say what the call should look like.
