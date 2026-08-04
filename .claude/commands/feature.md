---
description: Run a feature through the class loop — explore, plan, implement, test, summary.
---

Implement the following feature in this repo: **$ARGUMENTS**

Work through these five phases in order. Do not skip ahead, and do not
start editing files during phase 1 or 2.

## 1. Explore

Read the code that already exists around this feature before proposing
anything. Name the specific files you read. Identify the conventions this
repo already follows for the area you are about to touch — the repository
layer, the audit trail, thin controllers, validation style, test style.

## 2. Plan

State the plan before writing code:

- Which files you will change, and what each change does
- Which decisions the request left ambiguous, and what you are assuming
  for each one — call these out explicitly rather than quietly picking
- What you are deliberately NOT doing

If an ambiguous decision would change the public API or a policy rule,
stop and ask instead of assuming.

## 3. Implement

Follow the plan. Match the surrounding code's style. Follow the repo
conventions you identified in phase 1 — in particular:

- Data access goes through the module's repository, never the DataSource
- Every mutation writes an audit entry with an `entity.verb` action name
- Validation failures are `BadRequestException` naming the offending field
- Controllers stay thin

## 4. Test

Add tests that could actually fail. A test that would still pass if the
constant changed, or that only restates the implementation, is not a test —
cover the edge cases and the rejection paths, not just the happy path.

Then run `npm test` and show the real output. If anything fails, fix it and
run again. Do not report success without a passing run.

## 5. Summary

Close with:

- What changed, file by file
- Every assumption you made in phase 2, restated — so a human can veto it
- Anything you noticed but deliberately left alone
