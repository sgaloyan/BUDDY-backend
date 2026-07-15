# BUDDY API

Backend for **BUDDY** — a private, invite-only social utility app. Node.js + Express +
MongoDB (Mongoose), deployed to Google Cloud Run. The iOS client lives in a separate repo.

Built **spec-driven** and **AI-native**: every feature is specified in [`/specs`](./specs)
before implementation. See [`docs/ai-sdlc.md`](./docs/ai-sdlc.md) for the process.

## Requirements

- Node.js >= 22
- MongoDB (local or Atlas)

## Getting started

```bash
npm install
cp .env.example .env   # fill in values
npm run dev            # start with --watch on http://localhost:8080
```

Health check: `GET /healthz` → `{ "status": "ok" }`.

## Scripts

| Script                 | Purpose                                      |
| ---------------------- | -------------------------------------------- |
| `npm start`            | Run the server (`src/server.js`)             |
| `npm run dev`          | Run with `--watch` for local development     |
| `npm test`             | Run all tests via `node --test`              |
| `npm run test:watch`   | Run tests in watch mode                      |
| `npm run lint`         | ESLint                                       |
| `npm run format`       | Prettier (write)                             |

## Configuration

Config is read **only** in `src/config/`. `env.js` validates all variables at boot with
zod and fails fast. Secrets (`MONGODB_URI`, `JWT_SECRET`) may be provided as
`sm://projects/<project>/secrets/<name>` references, which are resolved from Google
Secret Manager in production; locally they are plain values from `.env`.

## Project layout

```
src/
  app.js            Express app factory (no listen) — imported by tests
  server.js         Loads config, connects Mongo, starts the listener
  config/           Validated env + Secret Manager resolution
  routes/           Path -> controller wiring
  controllers/      HTTP boundary
  services/         Business logic (framework-agnostic)
  models/           Mongoose schemas
  middleware/       Validation, auth, error handling
  lib/              Logger, HTTP errors, async wrapper
test/               node:test suites (integration + unit)
specs/              Feature specs (source of truth)
docs/               Process docs
```

## Deployment

Multi-stage `Dockerfile` targets Cloud Run: non-root, honors the injected `PORT`, and
compiles native `bcrypt` in the build stage.
