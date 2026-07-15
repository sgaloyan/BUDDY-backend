# Spec: <Feature Name>

> **Status:** Draft | Approved | Implemented
> **Slice:** <vertical slice this belongs to>
> **Owner:** <name>
> **Last updated:** <YYYY-MM-DD>

This spec is the **source of truth**. Code and tests must conform to it. If reality
must diverge, change the spec first, then the code.

## 1. Summary

One paragraph: what this feature does and why it exists.

## 2. Scope

- **In scope:** ...
- **Out of scope / non-goals:** ...

## 3. Data model

Collections/documents touched, fields, types, indexes, and constraints.

| Field | Type | Required | Notes |
| ----- | ---- | -------- | ----- |
|       |      |          |       |

## 4. API contract

For each endpoint:

### `METHOD /path`

- **Auth:** none | JWT
- **Request body:**

  ```json
  {}
  ```

- **Validation rules:** field-by-field constraints.
- **Responses:**

  | Status | When | Body |
  | ------ | ---- | ---- |
  | 200/201 | success | `{}` |
  | 400 | validation failed | `{ "error": { "message", "details" } }` |
  | 401 | ... | ... |

## 5. Behavior & business rules

Ordered rules the implementation must follow (hashing, uniqueness, side effects, etc.).

## 6. Errors

Enumerate error conditions and their exact status + message shape.

## 7. Acceptance criteria (test checklist)

Each item maps to at least one automated test.

- [ ] ...
- [ ] ...

## 8. Open questions

- ...
