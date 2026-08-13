# AI Workflow Orchestrator — Backend

Human-in-the-loop orchestration engine for AI-driven workflows. Executes multi-step workflows via a BullMQ job queue, pauses at steps that require human approval, and persists state in **PostgreSQL**.

![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs)
![Express](https://img.shields.io/badge/Express-4.22-000000?logo=express)
![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![BullMQ](https://img.shields.io/badge/BullMQ-5.79-FF6B6B)
![License](https://img.shields.io/badge/License-MIT-blue.svg)

> **Revision note:** an earlier revision of this document described a MongoDB/Mongoose persistence layer with a `MONGO_URI`-based connection string. The actual runtime environment defines `DATABASE_URL` in PostgreSQL format, with no `MONGO_URI` present. This revision updates database-facing details to PostgreSQL and flags any section whose underlying implementation detail (query library, error-shape mapping) was not independently re-verified against source after that change. See [Database: PostgreSQL](#database-postgresql) and [Known Limitations](#known-limitations).

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Database: PostgreSQL](#database-postgresql)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Core Systems](#core-systems)
- [Known Limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Overview

The backend accepts a **workflow template** (an ordered list of steps, each mapped to a tool such as sending an email, creating a calendar event, or creating a ticket), and executes it as a **run**. Each run is processed asynchronously by a BullMQ worker calling into a state-machine orchestrator.

Two things distinguish this from a plain job queue:

- **Human-in-the-loop approval** — any step flagged `requiresApproval` pauses the run (`waiting_approval`) until a human calls the approve/reject endpoint.
- **Mock / Real AI mode** — the orchestrator can run without calling the Anthropic API, generating deterministic placeholder content, or call the real Claude API using `ANTHROPIC_API_KEY`.

Communication: REST API (Express) for the frontend, PostgreSQL for persistence, Redis + BullMQ for the job queue.

## Architecture

```mermaid
graph TD
    A[Express Router] --> B[Controllers]
    B --> C[WorkflowService]
    C --> D[(PostgreSQL: workflows / workflow_runs)]
    C --> E[BullMQ Queue]
    E --> F[RunWorker]
    F --> G[Orchestrator State Machine]
    G --> D
    G --> H[AI Service - mock or Anthropic API]
```

The codebase separates concerns into distinct layers:

- **`api/`** — Express controllers and routes. Thin: validates input shape, delegates to services, formats the HTTP response.
- **`services/`** — Business logic (`WorkflowService`, `AIService`). No knowledge of `req`/`res`.
- **`core/`** — `Orchestrator`, the state machine that drives a run from step to step.
- **`models/`** — Data schemas for `Workflow` and `WorkflowRun`. The prior revision described these as Mongoose schemas; the query/ORM layer actually in use against PostgreSQL is **not confirmed** — see [Known Limitations](#known-limitations).
- **`config/`** — Centralized, Zod-validated environment access. This is the only layer allowed to read `process.env` directly.
- **`queues/` / `workers/`** — BullMQ queue definition and the worker process that consumes jobs.
- **`utils/`** — Logger (Winston), error handling (`AppError`), AI-mode state, redaction helpers.

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Runtime | Node.js >=20 | |
| Language | TypeScript, `strict: true` | |
| Framework | Express ^4.21 | |
| **Database** | **PostgreSQL**, connected via `DATABASE_URL` | Query/ORM layer not confirmed — see below |
| Queue | BullMQ + ioredis, connected via `REDIS_URL` | |
| AI | `@anthropic-ai/sdk` | Used when a real (non-mock) AI call is made; configured via `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` / `ANTHROPIC_FALLBACK_MODEL` |
| Logging | Winston | Console + rotating file transports |
| Security headers | Helmet | |
| Compression | `compression` | |

## Database: PostgreSQL

- **Connection:** a single `DATABASE_URL` variable in standard `postgresql://user:password@host:port/database` form, read through the same centralized, Zod-validated `config/` layer described above.
- **What changed from the prior revision:** the earlier document specified a `MONGO_URI` variable validated to start with `mongodb://` or `mongodb+srv://`, plus a set of Mongo-specific pool/timeout variables (`MONGO_MAX_POOL_SIZE`, `MONGO_SOCKET_TIMEOUT_MS`, etc.). None of these appear in the runtime environment. A `DATABASE_POOL_TIMEOUT` variable exists instead, consistent with a relational connection pool but without confirming which client library manages it.
- **What is not confirmed:** the specific query/ORM library (e.g., a raw `pg` client, Knex, Prisma, or something else), the actual table/column schema, and whether the migration from the previously-documented Mongoose implementation is complete or partial. **Insufficient evidence from repository** to state any of this as fact — verify directly against `config/database.config.ts` and the `models/` directory before publishing further claims.
- **Error handling caveat:** the error-handler mapping described in [API Reference](#api-reference) below was documented against Mongoose-specific error shapes (`ValidationError`, `CastError`, duplicate-key code `11000`). If those handlers were not updated alongside the database switch, PostgreSQL-specific error conditions (such as a unique-constraint violation) may not be mapped to the intended HTTP status. This should be re-verified against `utils/errorHandler.ts`.

## Project Structure

```
backend/
├── src/
│   ├── api/
│   │   ├── controllers/
│   │   │   ├── workflow.controller.ts   # Workflow/run/approval logic, called by routes
│   │   │   ├── settings.controller.ts   # AI mode get/set/status (current, used by routes.ts)
│   │   │   └── AISettings.ts            # Earlier version of the same controller, not wired into routes.ts
│   │   └── routes.ts                    # All route definitions + inline auth middleware
│   ├── config/
│   │   ├── schema.ts                    # Zod schema — single source of truth for env vars
│   │   ├── env.ts                       # Loads and freezes validated env; throws on invalid config
│   │   ├── ai.config.ts                 # Derives AI config from env
│   │   ├── database.config.ts           # DB connect/disconnect/health-check with retry
│   │   ├── redis.config.ts              # Redis client lifecycle + health-check
│   │   ├── types.ts                     # Shared HealthCheckResult type
│   │   └── index.ts                     # Public barrel export for the rest of the app
│   ├── core/
│   │   └── StateMachine.orchestrator.ts # The workflow execution engine
│   ├── models/
│   │   ├── Workflow.model.ts            # Workflow template schema
│   │   └── WorkflowRun.model.ts         # Run instance schema
│   ├── queues/
│   │   └── run.queue.ts                 # BullMQ queue + job helper functions
│   ├── services/
│   │   ├── workflow.service.ts          # CRUD + execution + stats for workflows/runs
│   │   └── ai.service.ts                # Mock/real content generation (separate from the orchestrator's own mock logic)
│   ├── utils/
│   │   ├── logger.ts                    # Winston logger, HTTP logger, redaction
│   │   ├── errorHandler.ts              # AppError, global error handler, catchAsync
│   │   ├── aiMode.ts                    # In-memory AI mode state (mock/real) + mock content generator
│   │   └── redact.ts                    # Generic object/URI credential redaction
│   ├── workers/
│   │   └── run.worker.ts                # BullMQ worker: consumes jobs, calls Orchestrator.process
│   └── app.ts                           # Express bootstrap, health endpoint, graceful shutdown
├── .env.example
├── package.json
└── tsconfig.json
```

**Note on duplication (unaffected by the database change):** `settings.controller.ts` and `AISettings.ts` implement near-identical AI-mode endpoints. Only `settings.controller.ts` is imported by `routes.ts`; `AISettings.ts` is dead code from an earlier refactor.

## Prerequisites

| Dependency | Version | Verify |
|---|---|---|
| Node.js | >=20.0.0 | `node --version` |
| npm | >=10.0.0 | `npm --version` |
| PostgreSQL | Insufficient evidence from repository for a required minimum version | `psql --version` |
| Redis | >=7.0 (previously documented; unaffected by the database change) | `redis-server --version` |

## Quick Start

```bash
# 1. Install dependencies
cd backend
npm ci

# 2. Configure environment
cp .env.example .env
# Edit .env — at minimum set DATABASE_URL and REDIS_URL;
# leave the AI provider unconfigured/mocked to avoid API costs if that mode is available

# 3. Start PostgreSQL and Redis locally (however you normally run them)

# 4. Run in dev mode
npm run dev

# 5. Verify
curl http://localhost:$PORT/health
```

`$PORT` should be set to whatever `PORT` is defined as in your own `.env`. Build/run commands defined in `package.json`:

```bash
npm run build   # tsc -> dist/
npm start       # node dist/app.js
npm run dev     # dev server with reload
```

There are no `test`, `lint`, or `db:migrate` scripts confirmed in `package.json` — see [Known Limitations](#known-limitations).

## Configuration

All environment variables are declared and validated through a centralized, Zod-validated `config/` layer. The process refuses to start if validation fails.

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | No | Environment name |
| `PORT` | No | HTTP listen port |
| `CORS_ORIGIN` | No | CORS origin policy |
| `DATABASE_URL` | **Yes** | PostgreSQL connection string (`postgresql://...`) |
| `DATABASE_POOL_TIMEOUT` | No | Connection pool timeout |
| `REDIS_URL` | No | Redis connection string used by BullMQ |
| `REDIS_RETRY_DELAY` | No | Redis reconnect delay |
| `JWT_SECRET` / `JWT_EXPIRY` | No | Present in the environment; **not confirmed to be enforced** — see [Known Limitations](#known-limitations) |
| `ANTHROPIC_API_KEY` | Conditional | Required for real (non-mock) AI calls |
| `ANTHROPIC_MODEL` / `ANTHROPIC_FALLBACK_MODEL` | No | Model selection |
| `ANTHROPIC_MAX_TOKENS` / `ANTHROPIC_TEMPERATURE` | No | Generation parameters |
| `WHATSAPP_API_TOKEN` / `WHATSAPP_VERIFY_TOKEN` / `WHATSAPP_API_VERSION` / `WHATSAPP_PHONE_NUMBER_ID` | No | Present in the environment; **integration behavior not documented** — see [Known Limitations](#known-limitations) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | Distributed tracing endpoint |
| `LOG_LEVEL` | No | Winston log level |
| `IDEMPOTENCY_TTL` | No | Idempotency key TTL |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_REQUESTS` | No | Present in the environment; rate-limiting middleware wiring not confirmed |
| `CIRCUIT_BREAKER_TIMEOUT` / `CIRCUIT_BREAKER_ERROR_THRESHOLD` | No | Circuit-breaker tuning |
| `RETRY_MAX_ATTEMPTS` / `RETRY_BACKOFF_BASE` | No | Retry policy tuning |
| `ENCRYPTION_KEY` | No | Present in the environment; specific algorithm not confirmed by any reviewed document |

Setup:

```bash
cp .env.example .env
# edit values, then restart
```

## API Reference

All routes are mounted under `/api` and pass through a lightweight auth middleware that reads a `user-id` header (defaults to `"system"`) — there is no token verification confirmed at this layer.

### Workflows

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/workflows` | List workflows. Query params: `isActive`, `tags` (comma-separated), `createdBy` |
| GET | `/api/workflows/:id` | Get one workflow |
| POST | `/api/workflows` | Create a workflow (`createdBy` set from the `user-id` header) |
| PUT | `/api/workflows/:id` | Update a workflow — blocked if the workflow has any run in `idle`, `running`, or `waiting_approval` state |
| DELETE | `/api/workflows/:id` | Soft-delete (deactivate) if it has historical runs; hard-delete otherwise |
| POST | `/api/workflows/:id/execute` | Create and enqueue a new run. Body: `{ context: object, idempotencyKey?: string }` |
| GET | `/api/workflows/:id/stats` | Aggregated run statistics for the workflow |

### Runs

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/runs` | List runs. Query params: `workflowId`, `status`, `limit`, `offset` |
| GET | `/api/runs/:id` | Get one run |
| POST | `/api/runs/:id/cancel` | Mark a non-terminal run as `failed` |

### Approvals

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/approvals/pending` | List runs currently in `waiting_approval`, capped at 50, oldest first |
| POST | `/api/runs/:id/approve` | Body: `{ approved: boolean }`. Approving executes the pending tool and resumes the run; rejecting sets status to `rejected` |

### Settings

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/settings/ai-mode` | Current mode + label/description |
| POST | `/api/settings/ai-mode` | Body: `{ mode: 'mock' \| 'real' }`. Changes process-wide, in-memory mode |
| GET | `/api/settings/ai-status` | Mode + whether an API key is configured + model name |

### Health

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Top-level health check (database, Redis, AI mode, memory usage) |
| GET | `/api/health` | Minimal `{ status: "ok" }` check — distinct from, and less detailed than, `/health` |

**Caveat on the `/health` response shape:** the previously documented response included a `services.mongodb` field. Whether that field has been renamed to reflect PostgreSQL is **not confirmed** — verify directly against `app.ts`.

**Caveat on error-status mapping:** the previously documented `errorHandler` mapped Mongoose-specific error types (`ValidationError`, `CastError`, duplicate-key code `11000`) to HTTP statuses. These mappings are specific to Mongoose and are **not confirmed to have an equivalent for PostgreSQL** (e.g., a unique-constraint violation, typically Postgres error code `23505`). Re-verify against `utils/errorHandler.ts` before relying on this behavior.

## Core Systems

### The Orchestrator (`core/StateMachine.orchestrator.ts`)

`Orchestrator.process(runId)` is the entry point called by the worker for every job. On each invocation it:

1. Loads the run; returns immediately if it's already `completed`, `failed`, or `rejected` (idempotent no-op on terminal states).
2. If `waiting_approval`, sends a notification (if configured) and returns — no state change happens until a human calls the approve endpoint.
3. Otherwise enters a bounded loop that:
   - marks the run `completed` once the current step index reaches the end of the step list;
   - transitions to `waiting_approval` if the current step needs approval;
   - advances past already-executed steps;
   - retries failed steps with exponential backoff, scheduled back onto the BullMQ queue rather than looped in-process;
   - for a fresh pending step, asks the AI layer for the next tool/arguments, appends a new step, executes the tool, and re-enqueues a continuation job.

The loop guard exists to stop a malformed or cyclic workflow definition from spinning the worker forever; hitting it marks the run `failed`.

**What "tool execution" actually does today:** it does not call any real external service (no confirmed email/calendar/ticketing integration). It waits briefly and returns a mock response object per tool name — this is unaffected by the database change and should not be treated as production-ready.

### Two independent AI-mock implementations

There are two separate places that generate mock AI content — the orchestrator's own decision generator, and a separate, more general per-tool mock generator used elsewhere in the AI service. These are not automatically kept in sync; if you're extending mock behavior, check both.

### Environment validation

The `config/` layer does more than type-check — it encodes real operational constraints, including a conditional requirement that an Anthropic API key be present before real (non-mock) AI calls are allowed, and boot-time failure on any invalid or missing required variable rather than a runtime surprise.

### Error handling

`AppError` carries a status code and an operational flag. The global error handler maps known error shapes to specific status codes; see the caveat above regarding which of those mappings are confirmed current after the PostgreSQL migration.

### Logging

Winston is configured with console and rotating file transports. A `redactSensitiveData()` helper strips keys matching common secret names (`password`, `token`, `secret`, `apiKey`, `authorization`, `cookie`, `session`, and similar) before logging.

### Graceful shutdown

On termination signals, the process stops accepting new HTTP connections, closes database and Redis connections, and allows the worker to finish active jobs (bounded by a timeout) before exiting.

## Known Limitations

- **Database documentation was out of date.** This revision corrects database-facing details to PostgreSQL based on the runtime `DATABASE_URL`. The exact query/ORM library, table schema, and whether the migration from the previously-documented Mongoose implementation is complete are **not confirmed** — verify directly against source before relying on further detail.
- **Error-handling and health-check details tied to the old database are unverified.** See the caveats in [API Reference](#api-reference) and [Database: PostgreSQL](#database-postgresql).
- **AI mode is process-global, in-memory state.** Changing it via the settings endpoint is not persisted, not per-user, and will reset on restart or diverge across multiple instances under horizontal scaling.
- **No confirmed authentication or authorization.** The `user-id` header is trusted as-is. `JWT_SECRET`/`JWT_EXPIRY` exist in the environment, but no confirmed JWT verification, session handling, or rate-limiting middleware is documented as actually mounted.
- **Tool execution is mocked.** Email, calendar, and ticketing tools return synthetic success payloads rather than calling real external services.
- **Duplicate/dead code:** an earlier controller duplicates the current settings controller and is not wired into routing. Two independent mock-AI-content code paths exist.
- **No test suite wired up.** No `test` script is confirmed in `package.json`.
- **WhatsApp integration is undocumented.** Credentials for it exist in the environment, but no documented code path describes how the integration works.

## Troubleshooting

| Problem | Likely Cause | Solution |
|---|---|---|
| Process refuses to start with a config validation error | A required env var is missing or malformed | Read the printed validation issue list — it names the exact field and rule that failed |
| Database connection error at boot | Malformed or unreachable `DATABASE_URL` | Confirm the connection string and that PostgreSQL is reachable from the process |
| AI call fails claiming a missing key | Real (non-mock) AI mode requested without `ANTHROPIC_API_KEY` set | Set the key, or switch to mock mode |
| Approve/reject returns "Run is not waiting for approval" | The run already moved past that step, or was never paused | Re-fetch run status before acting on stale UI state |
| Workflow update throws a "pending runs" error | Update blocked by design while runs are in flight | Wait for runs to finish, or create a new workflow instead |

## License

MIT
