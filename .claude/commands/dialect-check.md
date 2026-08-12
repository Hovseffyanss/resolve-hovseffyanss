---
description: Scan the diff for SQLite-vs-Postgres divergence — the class of bug that passes the test suite and fails in production.
argument-hint: [base-branch-or-range]
allowed-tools: Bash(git diff:*), Read, Grep, Glob
---

Check the current diff for changes that would behave differently on
in-memory better-sqlite3 (what tests run against) than on PostgreSQL 16
(what production runs). This is the check this repo's CLAUDE.md calls out
by name: "SQLite passing is not proof."

Diff base: **$ARGUMENTS** (default to `main` if empty). Run `git diff`
against it — don't rely on memory of earlier edits.

## What to look for

- Raw SQL with unquoted mixed-case identifiers (e.g. `tt.ticketId` instead
  of `tt."ticketId"`) — Postgres folds unquoted identifiers to lowercase
  and fails to find the column; SQLite is case-insensitive and won't catch
  it.
- New or changed columns that assume NOT NULL behavior, uniqueness, or a
  specific default — SQLite is lenient about nulls and constraints in ways
  Postgres is not.
- Any Postgres-only or SQLite-only SQL function, type, or syntax.
- New entity columns relying on `synchronize: true` to appear correctly on
  both dialects without a migration.

## Report

Output **only** this, filled in:

```
## Findings
- <file>:<line> — <what's risky> — <what happens on Postgres that
  wouldn't show up against SQLite>
(omit this section if there's nothing to flag)

## Checked, clear
<one line: what you looked at and found fine, so a reviewer doesn't
have to re-check the same ground>
```

## Prohibitions

- Do not modify any file — this command reports, it does not fix.
- Do not flag a finding without citing the exact file and line it's in;
  a vague "raw SQL might be risky somewhere" is not a finding.
