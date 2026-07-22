# BUDDY — Spec-Driven, AI-Native SDLC

How we build BUDDY's backend. The goal is that every change is traceable to a written
spec, and that AI assistants (and humans) can generate, review, and verify code against
that spec deterministically.

## Principles

1. **Spec first.** No feature code is written until a spec exists in [`/specs`](../specs)
   and is marked `Approved`.
2. **The spec is the source of truth.** Code and tests must conform to the spec. When
   reality forces a change, we update the spec **first**, then the code.
3. **One vertical slice at a time.** We take a single capability from HTTP route down to
   the database and finish it end-to-end (route → controller → service → model + tests)
   before starting the next.

## The loop

For each vertical slice:

1. **Write the spec** — copy `specs/_template.spec.md` to `specs/<feature>.spec.md` and
   fill in data model, API contract, validation, business rules, and acceptance criteria.
2. **Review & approve the spec** together. Set status to `Approved`.

   > **Gate — check this before writing a line of code.** Open the spec and confirm it
   > literally reads `Status: Approved`. `Draft` means implementation has not been
   > authorized to start, whoever or whatever is doing the writing. This is one `grep`,
   > and skipping it is exactly how slice 1 drifted (see below).

3. **Derive tests from the acceptance criteria** — each checklist item becomes at least
   one test in `test/` (`node --test`). Tests encode the spec, so they can be written
   before or alongside the implementation.
4. **Implement to pass** — write the minimum route/controller/service/model code needed
   to satisfy the spec and make the tests green.
5. **Verify against the spec** — run `npm test` and re-read the spec's acceptance
   criteria to confirm every item is covered. Update status to `Implemented`.

**Planned check (not built yet — a future slice).** The status gate above is currently
honor-system, and honor-system checks are precisely the kind that fail quietly. The
intended automation: a CI step (or pre-commit hook) that, for every `specs/*.spec.md`
touched by a PR, reads the `Status:` field and fails when a spec still marked `Draft`
ships alongside implementation code under `src/`. Roughly: if the diff touches `src/`
and the corresponding spec is not `Approved` or `Implemented`, the build goes red with a
message naming the spec. Cheap to write, and it converts a rule we have to remember into
one we cannot forget. Deliberately deferred — it deserves its own spec and slice rather
than being bolted onto the CI/CD work.

## Layering rules

Keep responsibilities separated so services stay unit-testable without HTTP or a live DB:

- **routes/** — map paths to controllers; attach validation middleware. No logic.
- **controllers/** — HTTP boundary: read validated input, call a service, shape the
  response. Never touch Mongoose directly.
- **services/** — business logic, framework-agnostic. Never reference `req`/`res`.
- **models/** — Mongoose schemas/models only.
- **middleware/** — cross-cutting request concerns (validation, auth, errors).
- **config/** — validated env + secret resolution; the only place `process.env` is read.

## Testing

- `node --test` (`npm test`) runs everything; HTTP-level tests use `supertest` against
  the app factory in `src/app.js` (no port binding, no real network).
- Integration tests live in `test/integration/`, isolated unit tests in `test/unit/`.

## CI/CD pipeline

`.github/workflows/` holds two workflows. They are deliberately separate: one is a
**gate** (it must pass), the other is an **advisor** (it must be read).

### `ci.yml` — the quality gate

Runs on every `push` and `pull_request`. Installs dependencies with `npm ci`, runs
`npm run lint`, then runs the full suite with `npm test`. A failure in either step
fails the job, and a red build blocks merge. This is non-negotiable and non-advisory:
if the tests are red, the spec is not satisfied, and the change does not land.

### `ai-review.yml` — the AI reviewer

Runs on `pull_request` (`opened`, `synchronize`). It computes the PR diff
(`base...head`), sends it to the Anthropic API (`claude-sonnet-4-6`), and posts the
review back as a PR comment. It reviews against the same source of truth everything
else uses — the specs in [`/specs`](../specs) — and is scoped to four categories:
spec-contract violations, security issues, correctness bugs, and error handling.

The review is **advisory**: it comments, it does not block. A reviewer who disagrees
with a finding closes it. The workflow skips with a clear message when no
`ANTHROPIC_API_KEY` secret is available (notably on fork PRs, where secrets are
withheld) rather than failing the build — a missing key is a configuration fact, not
a defect in the PR.

### Why both

**Tests catch what the spec anticipated.** Every acceptance criterion becomes a test,
so the suite is exactly as good as our foresight when we wrote the spec. That leaves a
gap, and the gap is not hypothetical — our manual `/code-review` pass on the auth slice
found three real defects that a fully green suite had said nothing about:

- **the signup race** — two concurrent signups for the same email both passed the
  "does this user exist?" check before either wrote. Tests asserted the sequential
  case, which is the case we thought of.
- **the error-handler 500** — the error middleware itself threw on a shape it didn't
  expect, converting a clean 4xx into a 500. Nothing asserted on the handler's own
  failure mode.
- **the bcrypt-72 truncation** — bcrypt silently truncates input past 72 bytes, so
  passwords differing only after byte 72 authenticate interchangeably. No test used a
  password that long, because no spec line said to.

Each is a class of issue tests are structurally bad at catching: concurrent
interleavings, the failure path of the failure handler, and silent truncation at a
dependency's boundary. None of them make a test go red. All of them are visible to a
careful reader of the diff. AI review is that reader, run on every PR instead of
whenever we remember to ask.

The two are complements, not substitutes. Tests are a gate because they are
deterministic; AI review is advisory because it is not. Neither one replaces a human
approving the PR.

### Failure mode: the silent empty review

The first live run of `ai-review.yml` posted a review with a correct header, a correct
footer, and **nothing in between**. It did not error. To a reader skimming the PR it was
indistinguishable from "the reviewer found nothing" — a hollow pass.

The cause was the token budget. The request set `max_tokens: 16000` together with
`thinking: { type: 'adaptive' }`, and **thinking tokens are drawn from the same
`max_tokens` budget as the visible answer**. On a large diff the model spent the entire
budget reasoning and was cut off before emitting a single text block. The API returned
`stop_reason: "max_tokens"` and `content: [{ type: "thinking" }]` with no text block, so
the script extracted the empty string and wrote it out verbatim.

Three mitigations, in order of importance:

1. **A degraded run must announce itself.** This was the real defect — not the
   truncation, but that the truncation was invisible. The script now inspects
   `stop_reason` and the presence of a text block, and prepends a loud
   `⚠️ Review incomplete` banner when either indicates a problem. It never emits a bare
   header and footer. **An AI reviewer that fails silently is worse than none**, because
   a hollow pass reads as a clean one and quietly buys false confidence.
2. **Thinking gets an explicit, separate budget.** `thinking.budget_tokens` is now set
   explicitly and `max_tokens` is set well above it, so the visible answer always has
   room reserved that thinking cannot consume. See `.github/scripts/ai-review.mjs` for
   the numbers and the tradeoff.
3. **The diff is capped.** Input size was never near the context limit — the real
   pressure a big diff creates is _more thinking_, which is what starves the text
   budget. The script caps the diff at a threshold, drops whole files rather than cutting
   mid-hunk, and names the omitted files in the output. A partial review says it is
   partial.

The general rule this leaves us with: **any degraded path in the pipeline must be
visible in its output.** Silence must never be the same shape as success.

## Current status

- [x] Project skeleton
- [x] Slice 1 — email/password auth (signup + login + refresh, bcrypt + JWT). Spec:
      [`specs/auth.spec.md`](../specs/auth.spec.md). Shipped in `b031f3a`; three defects
      found by manual review and fixed (signup race, error-handler 500, bcrypt-72
      truncation).
- [x] CI/CD pipeline — `ci.yml` gate + `ai-review.yml` advisor, shipped in `6ffa904`.
- [ ] Next slice — spec pending.

## Known process drift: slice 1 skipped the status transitions

Recorded deliberately rather than quietly corrected, because the failure is instructive.

**What happened.** `specs/auth.spec.md` went from `Draft` straight to shipped. It was
never marked `Approved` before implementation began, and was never marked `Implemented`
when it merged in `b031f3a` — it simply sat at `Draft` while the code went to `main`.
That breaks principle 1 ("no feature code until the spec is marked `Approved`") and step
5 of the loop. It has since been set to `Implemented`, which is now accurate: the spec's
content was always right and the code does conform to it. Only the status field had ever
been wrong.

**Why it matters more than a stale field.** The status field is the process's only
machine-checkable claim about itself. When `Draft` can mean "shipped to production," the
word stops carrying information, and the question it exists to answer — "has this been
approved?" — silently becomes unanswerable. Nothing broke, which is the point: this is
the kind of drift that costs nothing until the day it costs a lot.

**How it surfaced.** Not from the code, which was fine, and not from the tests, which
were green. It came out of the docs pass at the end of building the pipeline: writing
down what had actually shipped forced a check of what the spec claimed, and the two
disagreed. That is the same mechanism as the auth-slice defects, one level up — **a
careful reader comparing an artifact against its contract.** Tests check code against
the spec; nothing had been checking the spec against reality.

**The lesson.** The process caught this, but only because a human-and-AI pass happened
to look. That is not a control; that is luck with good habits. Hence the explicit gate
in step 2 of the loop and the planned CI check described alongside it — turn the
honor-system rule into an enforced one. A process that discovers its own drift is
working. A process that cannot drift silently is better.

The principle is the one the empty-review bug taught, turned on ourselves: **a degraded
state must announce itself.** A spec sitting at `Draft` while its code runs in production
is precisely a degraded state that stayed quiet.
