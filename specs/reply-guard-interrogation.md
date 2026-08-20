# Interrogation — Reply Guard v1.0

Questions against `specs/reply-guard.md` before any code exists. Each is a
place where two readings produce different implementations, or where an AC
cannot be tested as written.

---

## Ambiguities

**RG-1 vs RG-7 — who decides the verdict?** RG-1 shows `verdict` as a field of
the response. RG-7 says the verdict follows deterministically from the
findings. The spec never says whether the model produces the verdict at all.
- Reading A: the model returns only `findings`, `confidence`, `reasoning` and
  `injectionSuspected`; the service computes `verdict` and `requiresHuman`.
  The model never names a verdict, so there is no verdict for an attacker to
  assert.
- Reading B: the model returns the full shape including a verdict, and the
  service overwrites it from the findings.
These differ in what the prompt asks for, and B leaves a model-authored
verdict on the wire that a careless refactor could start trusting.

**RG-7 requires a field the response shape does not have.** RG-7 escalates on
"any HIGH **disclosure** finding, or any HIGH **commitment** finding." A
finding in RG-1 is `{ severity, issue }` — there is no category on it. Nothing
in the specified shape tells the code whether a HIGH finding came from check 1
or check 4.
- Reading A: add a `check` field (`disclosure` | `commitment` | `answer` |
  `tone`) to each finding, and key RG-7 off it.
- Reading B: drop the distinction and escalate on any HIGH finding at all.
- Reading C: string-match the `issue` text for the word "internal" — fragile,
  model-dependent, and silently wrong the day the wording changes.
As written, RG-7 is not implementable against RG-1's shape. This is the
gap most likely to produce a wrong implementation.

**RG-2 — "a request body carrying comments, notes, or ticket fields is
ignored."** Nest does not strip unknown body fields by default.
- Reading A: extra fields are silently ignored (nothing reads them).
- Reading B: extra fields are a 400, on the grounds that a caller passing
  `comments` believes they are being used and should be told otherwise.
The spec's word is "ignored", but a caller who thinks they are supplying the
notes and is silently overridden has a worse bug than a rejected request.

**Constraints — "data through a repository or an existing service."** Two
different layerings.
- Reading A: `RepliesService` injects `TicketsService` and calls `findById`,
  inheriting its 404 behaviour for free (RG-4 names `findById` explicitly).
- Reading B: `RepliesService` injects `TicketsRepository`, matching the
  existing cross-module precedent where `TicketsService` injects
  `CannedResponsesRepository` — and then RG-4's 404 must be re-implemented.
The spec names `findById` in RG-4 but the constraint permits either.

**RG-5 says the check order "decides which finding is reported first" — but no
AC constrains the order of `findings`.** RG-1 describes an array with no
ordering guarantee, and no acceptance criterion asserts one. Either the
ordering is a real requirement and needs an AC, or RG-5's justification for
the order is decorative.

---

## Missing edges

**The model returns 200 with unusable content.** RG-10 covers "no API key, an
API error, or a timeout" — all cases where the model is *unavailable*. It says
nothing about the model being available and returning prose instead of JSON,
malformed JSON, a `verdict` outside the enum, a `severity` that is neither
HIGH nor MEDIUM, or `findings` as an object rather than an array. This is the
most likely real-world failure and it is not "unavailable", so RG-10 as
written does not catch it — meaning it falls through to exactly the 500 that
RG-11 forbids.

**No bound on the input the ticket contributes.** RG-3 caps `draft` at 10000
characters. Nothing caps the ticket. A ticket with 400 comments is loaded in
full (RG-2) and sent to the model, which affects cost, latency, and whether
the request fits the context window at all. The spec never says whether to
truncate, how, or which comments to drop first — and dropping internal
comments to save space would defeat the entire feature.

**`confidence` is unvalidated.** RG-1 says "a number 0.0–1.0". Nothing says
what happens when the model returns `1.5`, `"high"`, or omits it.

**No model is named.** Nothing in the spec says which model to call. Cost per
check and p50/p95 latency — both of which the homework's optional tasks ask
you to measure — are properties of that choice, and the 10-second timeout in
RG-10 is only meaningful relative to it.

**Ticket with no internal comments.** The disclosure check is the reason the
feature exists, and it has nothing to compare against when a ticket has no
internal notes. Presumably checks 2–4 still run, but the spec never says so,
and an implementer could reasonably short-circuit to `SEND`.

---

## Undefined transitions

**Injection defeats the guard even with a deterministic verdict.** RG-7's
code-side mapping stops an attacker asserting `verdict: SEND` directly. It does
not stop the simpler attack: injected text that persuades the model to return
`findings: []`. Empty findings map to `SEND` by RG-7, and
`injectionSuspected` is itself model-reported — so a successful injection
reports that no injection occurred. RG-9 states the requirement but locates
the entire defence inside the component being attacked. Whether any
code-side structural detection exists is undefined.

**Invariant 2 is a prompt instruction, not an enforced property.** "Internal
comment bodies never appear in the response" — but `issue` and `reasoning` are
model-authored free text. Nothing in the spec inspects them before returning.
Either the invariant is enforced in code (scan model output for internal
comment content and redact or escalate), or it is a hope. As written it reads
like a guarantee and is not one.

**Timeout behaviour under a slow-but-successful response.** RG-10 treats a
10-second timeout as unavailability. It does not say whether the request to
the model is actually cancelled, or left running while the caller gets the
degraded response — which matters for cost, since an abandoned call is still
billed.

---

## Contradictions

**Invariant 3 vs the absence of any AC covering it.** "The four policy checks
and the style exclusion live in one place in the codebase, as text. Changing
the policy means editing that text, not changing control flow." No AC tests
this, and RG-7's verdict mapping is by definition control flow that encodes
policy — the escalation rule ("HIGH disclosure escalates") is a policy
decision living in code, not in the prompt text. The invariant and RG-7
disagree about where policy lives.

**Non-goals foreclose the homework's own optional task.** Non-goals say the
check is "not wired into `POST /tickets/:id/comments` in v1". Optional task A3
asks for exactly that wiring. Not a defect in the spec, but if A3 is intended,
v1's non-goal is the thing that has to change first, and it should be a
deliberate v1.1 amendment rather than a silent contradiction later.

---

## Untestable as written

**RG-9's injection requirement.** "Must not change the verdict" is only
testable against a fixed model response. With the real model it is a claim
about behaviour under adversarial input, which is exactly what homework task 4
exists to probe — but no AC describes the fixture that makes it a repeatable
test.

**RG-10's 10-second timeout.** A test that genuinely waits ten seconds does
not belong in this suite. Testable only with fake timers, and the spec does
not say so — and `CLAUDE.md` already warns that this suite needs frozen timers
for a different reason.

**Invariant 1 ("never mutates anything").** Testable only in the negative:
assert the ticket's `updatedAt`, comment count, and audit entry count are
unchanged after a check. Worth an explicit AC, because "we didn't write a
mutation" is not the same as proving none happens.

---

## Top 3 gaps most likely to cause a wrong implementation

1. **RG-7 keys the verdict off finding categories that RG-1's response shape
   does not carry.** The path of least resistance is string-matching the
   `issue` text, which works in the demo and breaks silently on rewording.
   The shape needs a `check` field, or RG-7 needs to stop distinguishing.

2. **A model that answers with unusable content is not covered by RG-10.**
   RG-11 forbids a 500 and demands a test proving it, but the degradation
   clause only names unavailability. Malformed JSON from a live model is the
   likeliest failure in production and currently falls through the gap — the
   "third behaviour nobody chose" the homework warns about, in the one place
   the spec claims to have closed.

3. **The injection defence lives entirely inside the model being attacked.**
   `injectionSuspected` is model-reported and empty findings map to `SEND`, so
   a successful injection is self-concealing. Without some code-side check,
   RG-9 is a statement of intent.
