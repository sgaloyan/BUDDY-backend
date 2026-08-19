# Spec: Spec-Status CI Gate

> **Status:** Implemented
> **Slice:** Slice 3 — Spec-status gate (process enforcement)
> **Owner:** Stepan
> **Last updated:** 2026-08-19 (rev 3 — implemented; 15 unit tests green plus an end-to-end CLI smoke test of all four exit paths. This spec is the first in the repo to pass Draft -> Approved -> Implemented in order.)

This spec is the **source of truth**. Code and tests must conform to it. If reality
must diverge, change the spec first, then the code.

> **Template adaptation.** This feature is a CI check, not an HTTP feature: it has no
> collections and no endpoints. Section numbers from `_template.spec.md` are kept stable
> for consistency; §3 is repurposed as the inputs the check reads, and §4 as its
> interface contract (CLI + workflow) instead of an API contract.

## 1. Summary

A CI check that makes the process's own rule machine-enforced instead of honor-system:
**implementation code must not ship alongside a spec still marked `Draft`.** Principle 1
of [`docs/ai-sdlc.md`](../docs/ai-sdlc.md) says no feature code is written until a spec
is `Approved`. Nothing currently verifies that, and slice 1 broke it silently — the auth
spec sat at `Draft` while its code ran in production. This slice converts a rule we have
to remember into one we cannot forget.

## 2. Scope

- **In scope:**
  - A Node script, `.github/scripts/spec-status-gate.mjs`, that evaluates a PR's changed
    files and the `Status:` field of any `specs/*.spec.md` the PR touches.
  - A **blocking** job in `.github/workflows/ci.yml`, running on `pull_request` only.
  - A pure, unit-testable core function separated from the git/filesystem shell.
- **Out of scope / non-goals (this slice):**
  - Any spec→code mapping. The check only inspects specs **the PR itself touches**; it
    does not attempt to infer which spec governs a given file under `src/`.
  - Requiring that every `src/` change touch a spec at all (see §5, R-3 for why).
  - A pre-commit hook. The doc offered it as an alternative; CI is the enforcement point
    because it cannot be skipped with `--no-verify`.
  - Treating `.github/`, `test/`, or `docs/` as implementation code (see §5, R-2, R-4).
  - Validating spec _content_ (that acceptance criteria exist, that sections are filled
    in). Only the `Status:` field is checked.

## 3. Inputs

The check reads exactly two things.

| Input         | Source                                                 | Notes                                            |
| ------------- | ------------------------------------------------------ | ------------------------------------------------ |
| Changed files | `git diff --name-only --diff-filter=d "$BASE...$HEAD"` | `--diff-filter=d` drops deletions (see §5, R-6). |
| Spec status   | The `Status:` line of each touched `specs/*.spec.md`   | Read from the **head** commit's working tree.    |

### 3.1 Which files are "specs"

A path counts as a spec iff it matches `specs/*.spec.md` **and** its basename does not
start with `_`. This excludes `specs/_template.spec.md` — whose status line reads
`Draft | Approved | Implemented` and is deliberately unparseable — and `specs/README.md`.

### 3.2 The status line

Parsed with `/^>\s*\*\*Status:\*\*\s*(.+?)\s*$/m` — the first match in the file. The
captured value must be exactly one of `Draft`, `Approved`, `Implemented` (case-sensitive,
after trimming). Anything else, including a missing line, is a **parse failure** and is
treated as a gate failure, not a pass (see §5, R-5).

### 3.3 Which files are "implementation code"

Any changed path under `src/`. Nothing else. See §5, R-2 and R-4 for the rationale.

## 4. Interface contract

### 4.1 `node .github/scripts/spec-status-gate.mjs`

- **Environment:** `BASE_SHA`, `HEAD_SHA` (both required; absent = configuration error).
- **Exit codes:**

  | Code | When                                                                           |
  | ---- | ------------------------------------------------------------------------------ |
  | 0    | No violation: gate passes.                                                     |
  | 1    | Violation: `src/` changed alongside a spec that is `Draft` or unparseable.     |
  | 2    | The check could not run (missing env, `git diff` failed). **Fails the build.** |

- **Output:** GitHub Actions annotations on stdout.
  - Violation → `::error title=Spec not approved::<specs/x.spec.md> is <status> but this PR changes implementation code under src/. Approve the spec first (docs/ai-sdlc.md, step 2).`
    One error line **per offending spec**, so a PR touching two bad specs names both.
  - Pass → a `::notice` naming the specs checked and their statuses, so a passing run
    still shows its work rather than being silently empty.

- **Exported core:** the module exports a pure function
  `evaluateGate({ changedFiles, specContents })` returning
  `{ ok: boolean, violations: [{ path, status }], checked: [{ path, status }] }`.
  It performs no I/O; the CLI wrapper supplies `changedFiles` from git and
  `specContents` from disk. This is what the unit tests exercise.

### 4.2 The `ci.yml` job

- A second job named `spec-gate` in the existing `ci.yml`, guarded by
  `if: github.event_name == 'pull_request'`.
- Checks out with `fetch-depth: 0` (it needs both sides of `base...head`).
- Runs independently of `build` — it is not a dependent step, so a lint failure and a
  spec-status failure are reported in the same run rather than one masking the other.
- Requires no npm install and no secrets: it is `git` plus Node stdlib only.

## 5. Behavior & business rules

- **R-1 — The core rule.** The gate fails iff the PR changes at least one path under
  `src/` **and** at least one touched spec is not `Approved` or `Implemented`.
- **R-2 — Spec-only PRs always pass.** A PR that touches specs but no `src/` path passes
  regardless of status. Writing and iterating on a `Draft` spec is exactly what step 1 of
  the loop asks for; blocking it would make the gate hostile to the process it enforces.
- **R-3 — `src/`-only PRs pass.** A PR that changes `src/` and touches no spec passes.
  Bugfixes and refactors of already-`Implemented` code legitimately touch no spec, and
  failing them would make the gate unusable. This is a **known, deliberate hole**: it
  means new implementation with no spec at all still slips through (see §8).
- **R-4 — `test/` is not implementation code.** Step 3 of the loop explicitly allows
  tests to be written before the implementation, so a PR adding tests derived from a
  `Draft` spec must pass.
- **R-5 — Unparseable status fails closed.** A touched spec whose `Status:` is missing or
  is not one of the three canonical values counts as a violation when `src/` changed. The
  status field is the process's only machine-checkable claim about itself; a value the
  machine cannot read is a degraded state, and per `docs/ai-sdlc.md` a degraded state must
  announce itself rather than pass quietly.
- **R-6 — Deleted specs are ignored.** A spec removed by the PR has no status to read and
  is not a violation. Hence `--diff-filter=d`.
- **R-7 — The check fails loud, never silent.** Any inability to compute an answer —
  missing `BASE_SHA`/`HEAD_SHA`, a failing `git diff` — exits 2 and fails the build with
  an explanatory annotation. It must never exit 0 on an indeterminate result. This is the
  empty-review lesson applied to a gate: silence must not be the same shape as success.
- **R-8 — This gate blocks.** Unlike `ai-review.yml`, this check is deterministic, so it
  is a gate and not an advisor. There is no `continue-on-error`.

## 6. Errors

| Condition                                               | Exit | Annotation                                                       |
| ------------------------------------------------------- | ---- | ---------------------------------------------------------------- |
| `src/` changed, touched spec is `Draft`                 | 1    | `::error title=Spec not approved::` naming the spec and status   |
| `src/` changed, touched spec has missing/unknown status | 1    | `::error title=Spec status unreadable::` naming the spec         |
| `BASE_SHA` or `HEAD_SHA` unset                          | 2    | `::error title=Spec gate could not run::` naming the missing var |
| `git diff` exits non-zero                               | 2    | `::error title=Spec gate could not run::` with git's stderr      |
| No violation                                            | 0    | `::notice title=Spec gate passed::` listing specs checked        |

## 7. Acceptance criteria (test checklist)

Each item maps to at least one test in `test/unit/spec-status-gate.test.js`, exercising
the pure `evaluateGate` export (no git, no network, no filesystem).

- [x] `src/` change + a `Draft` spec → `ok: false`, the spec listed in `violations`.
- [x] `src/` change + an `Approved` spec → `ok: true`.
- [x] `src/` change + an `Implemented` spec → `ok: true`.
- [x] Spec-only PR with a `Draft` spec (no `src/` paths) → `ok: true` (R-2).
- [x] `src/` change with no spec touched → `ok: true`, `checked` empty (R-3).
- [x] `test/` change + a `Draft` spec, no `src/` → `ok: true` (R-4).
- [x] `src/` change + a spec with **no** `Status:` line → `ok: false` (R-5).
- [x] `src/` change + a spec whose status is an unrecognized word → `ok: false` (R-5).
- [x] `specs/_template.spec.md` touched alongside a `src/` change → ignored, `ok: true`
      (§3.1) — the template's status line is unparseable by design.
- [x] `specs/README.md` touched alongside a `src/` change → ignored, `ok: true` (§3.1).
- [x] Two `Draft` specs + a `src/` change → **both** appear in `violations` (§4.1).
- [x] A passing run reports the specs it checked in `checked`, so the notice is never
      empty when specs were in fact examined.

## 8. Open questions

- **The R-3 hole.** New implementation shipped with no spec at all still passes. That is
  not hypothetical: the CI/CD slice itself shipped `.github/scripts/ai-review.mjs` and a
  test with no spec covering either. Closing it needs a spec→code mapping (or a
  convention like "every `src/` subdirectory has a governing spec"), which is a larger
  design question and deliberately deferred to its own slice.
- **Should `.github/` count as implementation code?** Under §3.3 it does not, which is
  why this slice's own PR will not trip its own gate — a mild irony, and arguably an
  argument for widening the definition later.
- **Bypass.** There is deliberately no escape hatch (no `[skip gate]` marker). If one
  turns out to be needed under real pressure, adding it is a spec change first.
