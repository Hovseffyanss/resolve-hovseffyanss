# Review gate calibration

Task 1, Class 5. Calibrating `.github/workflows/claude-code-review.yml` by
running two prompts over the same pull request and counting what came back.

**Target:** PR #11, `feat: canned responses and ticket tags` — 19 files,
~1,800 added lines across services, repositories, controllers and tests.
Chosen because it is real feature work that touches most of what the
conventions in `CLAUDE.md` are about.

The gate gained a `workflow_dispatch` trigger with `pr` and `mode` inputs so
the same PR could be reviewed twice on demand. Both prompts end with
`TOTAL FINDINGS: <n>` and post their review as a PR comment, so the runs are
countable rather than only readable.

## The counts

|                        | Reported | Actually real |
| ---------------------- | -------- | ------------- |
| **noisy**              | 7        | 4             |
| **tuned** (first pass) | 2        | 1             |
| **tuned** (calibrated) | 0        | 0             |

Both outputs are PR comments on
[#11](https://github.com/Hovseffyanss/resolve-hovseffyanss/pull/11), titled
`## Review gate — noisy` and `## Review gate — tuned`.

| Run           | Mode  | Workflow run |
| ------------- | ----- | ------------ |
| 18 Aug, 09:01 | noisy | `32119365262` |
| 18 Aug, 09:13 | tuned | `32120479076` |
| 18 Aug, 10:10 | tuned, after calibration | `32125428982` |

### What noisy found

Seven findings. Four were real defects, verified against the code:

1. `tag.util.ts:15` — a 31-character all-lowercase tag is rejected with
   "must contain only lowercase letters, digits and hyphens". Length and
   character-set share one message, so the caller is told the wrong thing.
2. `ticket-tag.entity.ts` — no unique index on `(ticketId, tag)`; the
   uniqueness invariant is a check-then-insert with an `await` in the gap.
3. `tickets.service.ts:197` — `TicketsRepository.removeTag` returns
   `removed: boolean` and the service discards it, so a losing race writes a
   `ticket.untagged` entry for a delete that deleted nothing.
4. `tickets.controller.ts` — `X-Actor:` with an empty value resolves to `''`
   on the three older routes and `'api'` on the three new ones.

Three were not: a redundant `@HttpCode(HttpStatus.CREATED)`, an unused module
export, and a note that a 404-vs-400 ordering is untested. All style or
observation, none of them a defect.

### What tuned found

Two findings, of which one was real — the tag-uniqueness gap, the same one
noisy raised. Tuned correctly dropped all three of noisy's style findings;
that is the exclusion list working.

The other tuned finding was a **false positive**, and it is the more
interesting result. Tuned opened with a HIGH claiming the PR "replaces the
repo's `CLAUDE.md` wholesale with an older draft." It did not:

```
git cat-file -e 27d2e24^:CLAUDE.md   →  does not exist
```

`CLAUDE.md` did not exist before PR #11 — that PR created it, and the commits
that reworked it came afterwards. A `workflow_dispatch` run checks out `main`,
so the gate read today's `CLAUDE.md` off disk, saw the older version in the
diff, and reported a regression. It was reviewing a merged PR against a newer
`main` and mistook the passage of time for a downgrade.

Worth saying out loud: the gate's single most confident finding, its only
HIGH, was an artifact of where it was standing.

## The finding I demoted, and why

**The tag-uniqueness MEDIUM.** `ticket_tags` has no unique constraint on
`(ticketId, tag)`, and `TicketsService.addTag` checks `ticket.tags.includes`
before `TicketsRepository.addTag` inserts, with an `await` between them. Two
simultaneous requests can both pass the check before either insert lands.

The finding is correct. I demoted it anyway.

Applying the bar — *would this block a merge at 6pm on a Friday?* — it needs
two genuinely concurrent requests hitting the same ticket with the same tag.
The worst outcome is `tags: ['bug', 'bug']` in one response. Nothing is lost,
no audit entry is corrupted, nothing returns an error to the caller. It is a
backlog item, not a reason to hold a deploy on a Friday evening.

The demotion is a rule in the prompt, not a judgement call made per-run:

> Races that need two concurrent requests against the same resource and whose
> worst outcome is cosmetic — a duplicate row, a repeated string in a response
> — with no data lost, no audit entry written for a mutation that did not
> happen, and nothing the caller sees as an error.

The exception is written into the same rule on purpose: a race that loses data
or corrupts the audit trail is still a finding, and still HIGH. Without that
carve-out the exclusion would quietly swallow the audit-correctness bugs this
repo protects hardest.

The second prompt change closed the false positive: the tuned prompt now
states that the checked-out tree is `main`, may be newer than the diff, and
that a file differing between the diff and its copy on disk is not evidence of
a regression.

Re-running tuned after both changes returned `TOTAL FINDINGS: 0`, verdict
approve — and it did not fall back to reporting style to fill the space.
Zero is the honest answer for a PR that was reviewed, merged, and has been in
production since 11 August.

## What the tuned gate gives up

Calibration is a trade, and this one has a cost worth naming.

Tuned dropped three findings that were real. Two of those drops are right: the
validation message does name its field, and the actor inconsistency is in code
this PR never touched.

The third is a genuine loss. `removeTag` discarding its `removed` boolean can
write a `ticket.untagged` audit entry for a mutation that did not happen, and
tuned does not catch it. That is an audit-correctness bug in a repo whose
first rule is that the audit trail tells the truth. It is an open gap in the
prompt's audit rule, not something the 6pm-Friday bar disposed of.
