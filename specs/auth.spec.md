# Spec: Email/Password Authentication

> **Status:** Implemented
> **Slice:** Slice 1 — Auth (signup + login + refresh)
> **Owner:** Stepan
> **Last updated:** 2026-07-16 (rev 3 — status set to `Implemented`; shipped in `b031f3a`, code and tests conform. This spec never passed through `Approved` — see "Known process drift" in [`docs/ai-sdlc.md`](../docs/ai-sdlc.md).)

This spec is the **source of truth**. Code and tests must conform to it. If reality
must diverge, change the spec first, then the code.

## 1. Summary

Email/password authentication for BUDDY. Users sign up with an email and password, then
log in to receive a short-lived access token (JWT) and a long-lived, revocable refresh
token. A refresh endpoint exchanges a valid refresh token for a new access token. This
is the first vertical slice: route → controller → service → model, end to end.

## 2. Scope

- **In scope:**
  - `POST /auth/signup` — create a user (no auto-login, no tokens).
  - `POST /auth/login` — verify credentials, issue access + refresh tokens.
  - `POST /auth/refresh` — exchange a valid refresh token for a new access token.
  - `User` and `RefreshToken` collections.
- **Out of scope / non-goals (this slice):**
  - Logout endpoint (see §9 — known limitation).
  - Refresh token **rotation** on use (refresh issues a new access token only; the
    refresh token itself is unchanged).
  - Email verification / confirmation emails.
  - Password reset / forgot-password.
  - Enforced rate limiting (specified as a future requirement in §5, R-6).
  - Invite-only gating (a separate slice).

## 3. Data model

### 3.1 `User` collection

| Field          | Type     | Required | Notes                                              |
| -------------- | -------- | -------- | -------------------------------------------------- |
| `email`        | String   | yes      | **Unique.** Normalized: `trim().toLowerCase()`.    |
| `passwordHash` | String   | yes      | bcrypt hash of the plaintext password.             |
| `createdAt`    | Date     | yes      | Set on creation.                                   |

- **Indexes:** unique index on `email` (stored already-normalized). This unique index
  **must be declared on the model** — it is the authoritative uniqueness guarantee, not
  the pre-insert existence check.
- **Concurrency:** signup performs an existence check, but that check races under
  concurrent requests. The unique index is the source of truth: a duplicate insert that
  slips past the pre-check raises a MongoDB duplicate-key error (code `11000`), which the
  service **must catch and translate to 409** (not surface as 500). See §4.1 / §6.
- The plaintext password is never stored or logged.

### 3.2 `RefreshToken` collection

Refresh tokens are **stateful** and stored **hashed** so they can be revoked. The chosen
verification strategy is **tokenId + bcrypt(secret)** (see §5, R-4), which requires a
`tokenId` lookup field in addition to the fields originally listed.

| Field       | Type     | Required | Notes                                                          |
| ----------- | -------- | -------- | -------------------------------------------------------------- |
| `userId`    | ObjectId | yes      | References `User._id`.                                         |
| `tokenId`   | String   | yes      | **Unique, indexed.** Public lookup handle (not a secret).      |
| `tokenHash` | String   | yes      | **bcrypt hash of the token `secret`.** Never the plaintext.    |
| `expiresAt` | Date     | yes      | Creation time + 7 days.                                        |
| `revoked`   | Boolean  | yes      | Defaults to `false`.                                           |

- **Indexes:**
  - unique index on `tokenId`;
  - index on `userId` (for future per-user queries);
  - **TTL index on `expiresAt` with `expireAfterSeconds: 0`**, so MongoDB automatically
    deletes refresh tokens once they pass `expiresAt`. This keeps the collection from
    growing unbounded given there is no logout/rotation/cleanup path this slice. TTL
    reaping is background/best-effort (~60s granularity); the `/auth/refresh` logic still
    checks `expiresAt` explicitly and never trusts reaping for correctness.
- Neither the plaintext refresh token nor its `secret` is ever stored or logged.

## 4. API contract

All request and response bodies are JSON. Error bodies follow the app-wide shape:
`{ "error": { "message": string, "details"?: [...] } }`.

### 4.1 `POST /auth/signup`

- **Auth:** none
- **Purpose:** Create a user only. Does **not** auto-login and returns **no tokens**.
- **Request body:**

  ```json
  { "email": "user@example.com", "password": "s3cret-pass" }
  ```

- **Validation rules:**
  - `email` — required, valid email format, normalized to `trim().toLowerCase()`.
  - `password` — required, **min 8 chars**, **max 72 chars**, **at least one letter and at
    least one digit**.
    - **Max-length rationale:** bcrypt only considers the first **72 bytes** of its input
      and silently truncates the rest. Without a max, two distinct long passwords sharing
      a 72-byte prefix would be interchangeable at login. We reject passwords longer than
      72 characters at signup rather than silently truncating. (72 chars ≤ 72 bytes only
      for single-byte characters; the limit is intentionally conservative for this slice.)
- **Responses:**

  | Status | When                        | Body                                                        |
  | ------ | --------------------------- | ----------------------------------------------------------- |
  | 201    | user created                | `{ "id": "<userId>", "email": "<normalized email>" }`       |
  | 400    | validation failed (incl. password > 72 chars) | `{ "error": { "message": "Validation failed", "details": [...] } }` |
  | 409    | email already registered (incl. concurrent duplicate) | `{ "error": { "message": "Email already registered" } }`    |

  > Note: signup necessarily reveals whether an email exists (409). Enumeration
  > protection applies to **login**, not signup (see §9).
  > Concurrent duplicate signups both returning correctly: at most one 201, the rest 409
  > (never 500) — see §3.1 concurrency note.

### 4.2 `POST /auth/login`

- **Auth:** none
- **Purpose:** Verify credentials and issue tokens.
- **Request body:**

  ```json
  { "email": "user@example.com", "password": "s3cret-pass" }
  ```

- **Validation rules:**
  - `email` — required, valid email format, normalized before lookup.
  - `password` — required, non-empty (full complexity rules are enforced at signup, not login).
- **Behavior:** look up the user by normalized email; verify password with `bcrypt.compare`.
- **Responses:**

  | Status | When                                     | Body                                                                 |
  | ------ | ---------------------------------------- | -------------------------------------------------------------------- |
  | 200    | credentials valid                        | `{ "accessToken": "<jwt>", "refreshToken": "<tokenId>.<secret>" }`   |
  | 400    | validation failed (missing fields, etc.) | `{ "error": { "message": "Validation failed", "details": [...] } }`  |
  | 401    | wrong password **OR** unknown email      | `{ "error": { "message": "Invalid email or password" } }`            |

  > **User-enumeration protection:** the 401 body and status are **identical** whether the
  > email does not exist or the password is wrong. The implementation must not branch in a
  > way that leaks existence via response content or status (see §9 for timing note).

### 4.3 `POST /auth/refresh`

- **Auth:** none (the refresh token is the credential; sent in the body).
- **Purpose:** Exchange a valid, non-revoked, unexpired refresh token for a new access token.
- **Request body:**

  ```json
  { "refreshToken": "<tokenId>.<secret>" }
  ```

- **Behavior:**
  1. Split the token on the first `.` into `tokenId` and `secret`. Malformed → 401.
  2. Look up the `RefreshToken` by `tokenId`. Not found → 401.
  3. Reject if `revoked === true` or `expiresAt <= now` → 401.
  4. `bcrypt.compare(secret, tokenHash)`; mismatch → 401.
  5. On success, issue a **new access token** for the token's `userId`.
- **Responses:**

  | Status | When                                                   | Body                                     |
  | ------ | ------------------------------------------------------ | ---------------------------------------- |
  | 200    | refresh token valid, non-revoked, unexpired            | `{ "accessToken": "<jwt>" }`             |
  | 400    | `refreshToken` missing/not a string                    | `{ "error": { "message": "Validation failed", "details": [...] } }` |
  | 401    | malformed, unknown, revoked, expired, or secret mismatch | `{ "error": { "message": "Invalid refresh token" } }`             |

  > The refresh token is **not rotated** in this slice — the same refresh token remains
  > valid until it expires or is revoked. Only a new access token is returned.

## 5. Behavior & business rules

- **R-1 — Password hashing.** Passwords are hashed with **bcrypt** before storage. Plaintext
  is never persisted or logged.
- **R-2 — Email normalization.** Emails are normalized with `trim().toLowerCase()` on both
  signup and login before storage/lookup; uniqueness is therefore case-insensitive.
- **R-3 — Access token.** JWT signed with `JWT_SECRET` (HS256). **Payload: `{ userId, email }`.**
  **Lifetime: 15 minutes.** `email` is the normalized email.
- **R-4 — Refresh token (stateful, revocable).**
  - Format: `"<tokenId>.<secret>"`, where `tokenId` and `secret` are cryptographically
    random, URL-safe strings. Only the **first** `.` is the delimiter.
  - Stored as: `{ userId, tokenId, tokenHash: bcrypt(secret), expiresAt, revoked: false }`.
  - **Lifetime: 7 days** (`expiresAt = now + 7d`).
  - Verified on refresh by looking up `tokenId`, then `bcrypt.compare(secret, tokenHash)`,
    then checking `revoked` and `expiresAt`.
- **R-5 — User-enumeration protection.** Login failures (unknown email vs. wrong password)
  return an identical status (401) and body (`"Invalid email or password"`).
- **R-6 — Rate limiting on `/auth/login` (PLANNED / FUTURE — deferred).** Intent: throttle
  repeated failed login attempts (per IP and/or per email) to slow credential brute-force
  and enumeration-by-timing. **Implementation deferred to a later slice**; no throttling is
  built in this slice. Recorded here so it is not forgotten and can be specced/tested later.

## 6. Errors

| Condition                                             | Status | `error.message`                |
| ----------------------------------------------------- | ------ | ------------------------------ |
| Request body fails validation (incl. password > 72 chars) | 400 | `Validation failed` (+`details`) |
| Malformed / unparseable JSON request body             | 400    | (body-parser message; **must be 400, not 500**) |
| Signup with an already-registered (normalized) email  | 409    | `Email already registered`     |
| Login with unknown email or wrong password            | 401    | `Invalid email or password`    |
| Refresh token malformed/unknown/revoked/expired/mismatch | 401 | `Invalid refresh token`        |
| Unexpected/unhandled server error                     | 500    | `Internal server error`        |

- **Malformed JSON → 400.** A request with an unparseable JSON body must return **400**,
  not 500. The centralized error handler honors the status carried by such errors
  (`err.status` / `err.statusCode`, e.g. body-parser sets 400) instead of collapsing every
  non-`HttpError` to 500. Only genuinely unexpected errors (no status) become 500.

## 7. Acceptance criteria (test checklist)

Each item maps to at least one automated test (`node --test` + `supertest`).

### Signup — `POST /auth/signup`

- [ ] Valid email + valid password → **201**, body `{ id, email }`, no tokens in response.
- [ ] Password is stored **hashed** (persisted `passwordHash !== plaintext`; bcrypt verifies).
- [ ] Email is persisted **normalized** (e.g. `Foo@X.com ` → `foo@x.com`).
- [ ] Duplicate email (same after normalization) → **409** `Email already registered`.
- [ ] Password shorter than 8 chars → **400** `Validation failed`.
- [ ] Password with letters but no digit → **400**.
- [ ] Password with digits but no letter → **400**.
- [ ] Password longer than 72 chars → **400** `Validation failed`.
- [ ] Missing or malformed email → **400**.
- [ ] Signup returns **no** access or refresh token.
- [ ] Two concurrent signups for the same (normalized) email → exactly one **201** and one
      **409** `Email already registered` (**never 500**); only one `User` persisted.
- [ ] A malformed / unparseable JSON body → **400** (not 500).

### Login — `POST /auth/login`

- [ ] Correct email + password → **200** with `accessToken` and `refreshToken`.
- [ ] Access token is a JWT whose payload contains `userId` and `email` and expires in ~15 min.
- [ ] A `RefreshToken` document is created: `revoked=false`, `expiresAt ≈ now + 7d`, and
      `tokenHash` is a bcrypt hash (not the plaintext secret).
- [ ] Login with a valid email but wrong password → **401** `Invalid email or password`.
- [ ] Login with an unknown email → **401** with the **same** body/status as wrong password.
- [ ] Login email matching is case-insensitive (`FOO@x.com` logs into the `foo@x.com` account).
- [ ] Missing email or password → **400**.

### Refresh — `POST /auth/refresh`

- [ ] Valid, non-revoked, unexpired refresh token → **200** with a new `accessToken`.
- [ ] The returned access token is newly issued (fresh `exp`/`iat`).
- [ ] Refresh token is **not** rotated (the same token can be used again while valid).
- [ ] Revoked refresh token (`revoked=true`) → **401** `Invalid refresh token`.
- [ ] Expired refresh token (`expiresAt` in the past) → **401** `Invalid refresh token`.
- [ ] Unknown `tokenId` → **401**.
- [ ] Correct `tokenId` but wrong `secret` → **401**.
- [ ] Malformed token (no `.`, empty) → **401** (or 400 if the field itself is missing).

## 8. Security notes

- **User-enumeration protection (R-5):** identical failure response for unknown-email and
  wrong-password on login.
- **Refresh tokens stored hashed (R-4):** only `bcrypt(secret)` is persisted; the plaintext
  refresh token cannot be reconstructed from the database.
- **No refresh-token rotation (consciously-accepted trade-off):** because a refresh token
  is not rotated on use (R-4), a **stolen refresh token remains usable for its full 7-day
  lifetime** — an attacker who exfiltrates one has a 7-day window, and it cannot be
  distinguished from legitimate use without rotation. The mitigation is **rotation**:
  issue a new refresh token on each `/auth/refresh` call and invalidate (revoke) the old
  one, so a replayed old token is rejected and reuse is detectable. Rotation is
  **deferred to a future slice**; this slice knowingly accepts the wider exposure window.
- **Rate limiting (R-6):** planned/future requirement, implementation deferred this slice.
- **Timing side-channel (acknowledged, not mitigated this slice):** login may still leak
  existence via response-time differences (bcrypt runs only when a user is found). Mitigation
  (e.g. comparing against a dummy hash) is deferred; noted so it can be addressed with R-6.
- **Signup enumeration (acknowledged):** signup's 409 reveals that an email is registered.
  Accepted for this slice; a future invite/verification flow may change this.

## 9. Known limitations (this slice)

- **No logout endpoint.** Access tokens are stateless and remain valid until they expire
  (~15 min). Refresh tokens *can* be revoked (the `revoked` flag exists), but there is no
  endpoint to revoke them yet — so no user-facing logout flow in this slice.
- **No refresh-token rotation.** A refresh token is reusable until expiry/revocation.
- **No enforced rate limiting** on login (R-6, deferred).

## 10. Open questions / future optimizations

- None outstanding. (Refresh-token strategy = tokenId + bcrypt(secret); email = normalized
  lowercase — both confirmed.)
- **Future optimization — parallelize token issuance on login.** `login` currently issues
  the access token and the refresh token sequentially, but they are independent; the
  refresh path includes a bcrypt hash, so serializing them adds avoidable latency to the
  hot login path. Issue them concurrently (`Promise.all`) in a later pass. *Logged, not
  implemented this slice.*
