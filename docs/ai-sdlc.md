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

## CI (planned)

`.github/workflows/` will hold CI that lints, runs tests, and adds AI-powered review
steps. Added once the first slice lands.

## Current status

- [x] Project skeleton
- [ ] Slice 1 — email/password auth (signup + login, bcrypt + JWT) — spec pending
