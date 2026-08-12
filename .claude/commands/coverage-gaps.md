---
description: Check a spec's AC ids against the test suite — what has no test, what tests shape instead of behavior, and the single highest-value test to add next.
argument-hint: [path/to/spec.md]
allowed-tools: Read, Grep, Glob
---

Audit test coverage for the spec at **$ARGUMENTS**.

If no path is given, find the most recently modified file in `specs/` and
use that — but say which file you picked.

## 1. Extract every AC

Read the spec and list every AC id it defines (`AC-1`, `AC-2`, ...). Do not
skip any, even ones that look minor.

## 2. Find its test

For each AC id, `grep` the test suite for that id in a test name (this
repo's convention: `it('AC-9: ...')`). An AC only counts as tested if a
test name references it — a comment or a variable name doesn't count.

## 3. Judge what you find

For every AC that does have a test, read that test and judge whether it
asserts *behavior* (a specific input produces a specific output or throws a
specific error) or *shape* (it asserts that a function was called, that an
object has a key, or that something merely doesn't throw — the kind of test
that would still pass if the underlying logic were deleted).

## 4. Report

Output **only** this, filled in:

```
## Spec
<path to the spec file used>

## AC with no test
- AC-<id>: <one-line summary of what the AC requires>
(omit this section header if none)

## Tests asserting shape, not behavior
- <file>:<line> — AC-<id> — <what it checks> — <what it should check instead>
(omit this section header if none)

## Highest-value missing test
<one paragraph: which single test to write next, exactly what it should
assert, and why this one beats the other gaps found above>
```

## Prohibitions

- Do not write, edit, or run any test file — report only.
- Do not count an AC as covered because a *different* AC's test happens to
  exercise the same code path. If the spec numbers it separately, it needs
  its own named test.
