# Specs

Every feature starts as a spec here **before** any implementation exists. The spec is
the source of truth; code and tests are derived from it and must conform to it.

## Conventions

- One file per feature: `<feature>.spec.md` (e.g. `auth.spec.md`).
- Copy [`_template.spec.md`](./_template.spec.md) to start a new spec.
- A spec is `Approved` before implementation begins, and marked `Implemented` once the
  slice is merged with passing tests.

## Spec → code → test mapping

| Spec section        | Lands in                                           |
| ------------------- | -------------------------------------------------- |
| Data model          | `src/models/`                                      |
| API contract        | `src/routes/`, `src/controllers/`                  |
| Validation rules    | zod schema + `src/middleware/validate.js`          |
| Business rules      | `src/services/`                                    |
| Acceptance criteria | `test/integration/` and `test/unit/`               |

See [`../docs/ai-sdlc.md`](../docs/ai-sdlc.md) for the full workflow.
