---
description: Draft a PR description from the diff and its spec — summary, AC ids covered, reviewer risks, and what was deliberately skipped.
argument-hint: [base-branch-or-range]
allowed-tools: Bash(git diff:*), Bash(git log:*), Bash(git status:*), Read, Grep, Glob
---

Draft a pull request description for the current branch's changes.

Diff base: **$ARGUMENTS** (default to `main` if empty).

## 1. Read the diff

Run `git diff` against the base and `git log` to see the commits included.
Do not read this from memory or from the conversation — run the commands.

## 2. Find the spec

Look in `specs/` for a spec file that matches the feature this diff
implements (by filename or by AC ids referenced in test names, e.g.
`it('AC-9: ...')`). If more than one spec plausibly matches, or none does,
say so instead of guessing which one.

## 3. Write the description

Output **only** the following, filled in — no preamble, no "Here's the PR
description":

```
## Summary
<2-4 sentences: what changed and why, in plain language>

## AC covered
- AC-<id>: <one line — what the diff does to satisfy it>
(list every AC id found in the diff's test names or the matched spec; if an
AC in the spec has no corresponding change in this diff, do not list it here)

## Risks
- <specific file/behavior a reviewer should check first, and why it's risky>
(order by severity; this repo's usual risks are: audit entries missing on a
new mutation path, raw SQL that passes on SQLite but not Postgres, and
validation that moved into the wrong layer)

## Deliberately not done
- <anything the spec or an obvious extension implies that this diff
  intentionally skips, and why>
```

## Prohibitions

- Do not run `git commit`, `git push`, or `gh pr create` — this command
  only drafts text for you to review and use yourself.
- Do not list an AC as covered unless you can point to the specific test or
  code change that covers it. If you're not sure, list it under Risks
  instead of Summary.
