# CLAUDE.md

BUDDY API — Node 22 + Express + Mongoose (MongoDB), deployed to Cloud Run. The iOS
client lives in a separate repo.

Built **spec-first**: the spec in [`/specs`](./specs) is the source of truth, not the
code and not the tests. Full process: [`docs/ai-sdlc.md`](./docs/ai-sdlc.md) — read it
before starting a feature.

## Before writing any code under `src/`

Confirm the spec authorizes it. This is a gate, not a formality:

```bash
grep "Status:" specs/<feature>.spec.md   # must read Approved or Implemented
```

`Draft` means implementation has **not** been authorized to start — whoever or whatever
is doing the writing. Skipping this check is exactly how slice 1 drifted: `auth.spec.md`
sat at `Draft` while its code ran in production.

CI enforces this on pull requests (the `spec-gate` job), but only for specs a PR
actually touches. New code with no spec at all still passes, so the check above remains
yours to run.

Starting a new feature? Copy [`specs/_template.spec.md`](./specs/_template.spec.md),
fill it in, and get it to `Approved` **before** writing code.

## Layering

Kept strict so services stay unit-testable without HTTP or a live DB:

- `routes/` — map paths to controllers, attach validation middleware. No logic.
- `controllers/` — HTTP boundary only. Never touch Mongoose directly.
- `services/` — business logic, framework-agnostic. Never reference `req`/`res`.
- `models/` — Mongoose schemas and models only.
- `config/` — validated env + secrets. The **only** place `process.env` is read.

## Commands

```bash
npm test          # node --test, the full suite
npm run lint      # eslint
npm run dev       # local server with --watch
```

## Finishing a slice

- Every acceptance criterion in the spec maps to at least one test in `test/`.
- Set a spec to `Implemented` only after `npm test` is green.
- Behavior needs to change? **Change the spec first, then the code** — never the reverse.
