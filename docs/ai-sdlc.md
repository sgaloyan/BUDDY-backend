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
3. **Derive tests from the acceptance criteria** — each checklist item becomes at least
   one test in `test/` (`node --test`). Tests encode the spec, so they can be written
   before or alongside the implementation.
4. **Implement to pass** — write the minimum route/controller/service/model code needed
   to satisfy the spec and make the tests green.
5. **Verify against the spec** — run `npm test` and re-read the spec's acceptance
   criteria to confirm every item is covered. Update status to `Implemented`.

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

## Current status

- [x] Project skeleton
- [ ] Slice 1 — email/password auth (signup + login, bcrypt + JWT) — spec pending
