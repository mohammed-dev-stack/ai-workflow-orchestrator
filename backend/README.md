<div align="center">

# منصتي — Mansati Backend API

### The service layer powering the Mansati Arabic social platform.

![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express.js-5.x-000000?style=for-the-badge&logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15.x-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Socket.io](https://img.shields.io/badge/Socket.io-4.x-010101?style=for-the-badge&logo=socket.io&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)

</div>

> **How to read this document.** Every claim below is tagged: **✅ Confirmed** (stated directly in this repository's own documentation), **🔍 Inferred** (not confirmed here, but strongly implied by the frontend's documented service layer — e.g., a `followService.ts` implies follow/unfollow endpoints exist somewhere), **⚠️ Not documented** (a real gap — no evidence either way), or **📋 Planned** (explicitly future work, not present). No test-coverage or CI badges are included above because none of those systems are documented as existing yet.

---

## Table of Contents

1. [Overview](#overview)
2. [What This Is & Why It Exists](#what-this-is--why-it-exists)
3. [System Architecture](#system-architecture)
4. [API Architecture](#api-architecture)
5. [Authentication Flow](#authentication-flow)
6. [Authorization Model](#authorization-model)
7. [Database Architecture](#database-architecture)
8. [Security Architecture](#security-architecture)
9. [Validation Layer](#validation-layer)
10. [Error Handling Strategy](#error-handling-strategy)
11. [Logging Strategy](#logging-strategy)
12. [Rate Limiting](#rate-limiting)
13. [Real-time Architecture (Socket.IO)](#real-time-architecture-socketio)
14. [Performance Considerations](#performance-considerations)
15. [Scalability Considerations](#scalability-considerations)
16. [Folder Structure](#folder-structure)
17. [Environment Variables](#environment-variables)
18. [Installation & Setup](#installation--setup)
19. [Development Workflow](#development-workflow)
20. [Deployment](#deployment)
21. [Monitoring Considerations](#monitoring-considerations)
22. [Future Improvements](#future-improvements)
23. [Contributing Guide](#contributing-guide)
24. [License](#license)
25. [Author & Contact](#author--contact)

---

## Overview

✅ **Confirmed**: Mansati's backend is a Node.js/Express + PostgreSQL (via Prisma) service that provides a REST API and a Socket.IO real-time channel to the companion [Next.js frontend](https://github.com/mohammed-dev-stack/mansati-frontend). It follows a layered/clean architecture: routes → middleware → controllers → services → data layer, with services as the only layer documented as touching the database.

## What This Is & Why It Exists

The frontend needs an authority it can't be: something that owns passwords (hashed, never in the client), enforces who's allowed to see or delete what, and fans real-time events out to every connected client consistently. That's this service's job. The layered structure exists for a specific reason beyond "best practice" — it's what lets the admin console, the public feed, and the real-time layer all share one business-rule implementation (the services layer) instead of three route handlers quietly reimplementing "what counts as a valid post" slightly differently.

🔍 **Inferred from frontend service layer**: the frontend ships eight distinct service modules (`api`, `adminService`, `followService`, `messageService`, `notificationService`, `postService`, `socketService`, `userService`), which means the actual API surface this backend exposes is materially larger than the 5 endpoints confirmed in source — see [API Architecture](#api-architecture) for the inferred breakdown.

---

## System Architecture

```mermaid
graph TD
    A[Client - Next.js frontend] -->|HTTP| B[Routes / API layer]
    A -->|WebSocket| G[Socket Manager]
    B --> C[Middleware - Auth & Security]
    C --> D[Controllers - Request handling]
    D --> E[Services - Business rules]
    E --> F[(PostgreSQL via Prisma)]
    D --> G
    G --> F
```

✅ **Confirmed layer responsibilities:**

| Layer | Responsibility |
|---|---|
| **Routes** | Define API endpoints, map HTTP verbs/paths to controllers |
| **Middleware** | Authentication/authorization checks, security headers, centralized error handling |
| **Controllers** | Request/response handling — parse input, call services, shape the response |
| **Services** | Business rules — the only layer documented as talking to the data layer |
| **Prisma schema** | Table definitions and relations (⚠️ field-level schema not documented in source) |
| **Socket Manager** | WebSocket event handling for chat/notifications, running alongside the controller layer |

---

## API Architecture

✅ **Confirmed** (5 representative endpoints, explicitly documented):

| Domain | Method | Path | Purpose |
|---|---|---|---|
| Auth | `POST` | `/api/auth/register` | Register a new user |
| Auth | `POST` | `/api/auth/login` | Log in |
| Posts | `GET` | `/api/posts` | Fetch posts |
| Messages | `POST` | `/api/messages` | Send a message |
| Admin | `GET` | `/api/admin/stats` | Dashboard statistics |

🔍 **Inferred from frontend service layer** — each frontend service module implies a corresponding backend surface. These are **not confirmed** endpoints; they are the minimum API shape needed to support what the frontend README documents as working functionality. Treat method/path spellings as illustrative, not authoritative — only the *existence* of the capability is a reasonable inference, not the exact route signature:

| Domain | Frontend service | Implied capabilities |
|---|---|---|
| Users | `userService.ts` | Registration, login, profile update, avatar/cover upload |
| Follow | `followService.ts` | Follow, unfollow, follow-status check, list followers/following |
| Posts | `postService.ts` | Create/read/update/delete posts, add reactions (7 types), comment, share |
| Messages | `messageService.ts` | Send/receive messages, list conversations, mark read, search users |
| Notifications | `notificationService.ts` | List notifications, mark as read (single/all), delete |
| Admin | `adminService.ts` | Dashboard stats, user management (list/filter/delete/enable-disable/role edit, bulk actions), post management (list/filter/delete, bulk), message management (list/delete, bulk), analytics (time-range charts), system health, settings (read/write) |

⚠️ **Not documented**: request/response body shapes, pagination conventions, API versioning, or a complete verified route inventory. The table above is a planning aid for verifying against `routes/`, not a substitute for reading it.

**Request lifecycle** (✅ confirmed shape, from the architecture layering):

```mermaid
sequenceDiagram
    participant Client
    participant Route
    participant Middleware as Auth Middleware
    participant Controller
    participant Service
    participant DB as PostgreSQL

    Client->>Route: HTTP request (+ JWT)
    Route->>Middleware: verify token / role
    alt invalid or missing token
        Middleware-->>Client: 401 / 403
    else valid token
        Middleware->>Controller: forward request
        Controller->>Service: execute business logic
        Service->>DB: query/mutate via Prisma
        DB-->>Service: result
        Service-->>Controller: processed data
        Controller-->>Client: JSON response
    end
```

---

## Authentication Flow

```mermaid
sequenceDiagram
    participant Client
    participant AuthCtrl as Auth Controller
    participant Service as Auth Service
    participant DB as PostgreSQL

    Client->>AuthCtrl: POST /api/auth/login (credentials)
    AuthCtrl->>Service: validate credentials
    Service->>DB: look up user, compare hash (bcrypt)
    DB-->>Service: user record
    Service-->>AuthCtrl: issue Access Token + Refresh Token
    AuthCtrl-->>Client: tokens set as HttpOnly cookies

    Note over Client,AuthCtrl: Subsequent requests
    Client->>AuthCtrl: request + cookie (Access Token)
    AuthCtrl->>AuthCtrl: verify Access Token
    alt expired
        Client->>AuthCtrl: refresh using Refresh Token
        AuthCtrl-->>Client: new Access Token
    end
```

✅ **Confirmed**:
- Dual-token JWT model — separate Access and Refresh tokens.
- Both tokens documented as stored in **HttpOnly cookies**.
- Password hashing via **Bcrypt.js**.

⚠️ **Cross-repository inconsistency, unresolved**: the frontend's own documentation states token storage two different ways in two different sections — HttpOnly cookies in one place, `sessionStorage` (with a cookie fallback) in another. This backend's documentation asserts HttpOnly cookies, which is what a security-conscious implementation should do — but "should" isn't "does." This should be resolved by reading the actual `Set-Cookie` logic in the auth controller and the frontend's Axios interceptor together, not by picking whichever claim sounds more secure.

⚠️ **Not documented**: token expiry durations, refresh-token rotation/invalidation policy (does a used refresh token get revoked?), and whether logout performs server-side token revocation or is purely a client-side cookie clear.

---

## Authorization Model

✅ **Confirmed**: role-gated access exists. An admin-only endpoint (`GET /api/admin/stats`) is documented, and the frontend independently confirms an admin role via a dedicated bootstrap flow (`/admin-login`, creating the first super-admin from env credentials) and a role-editing UI for other users.

🔍 **Inferred**: given the frontend's admin console covers user, post, and message *moderation* (delete, disable, bulk actions) as well as settings and analytics, the authorization model most likely gates each of those admin routes individually via middleware, rather than a single blanket "is-admin" check protecting only the dashboard — but this is architecture the frontend's feature list implies, not something confirmed in backend source.

⚠️ **Not documented**: the specific role enum (`user` / `admin` only, or more granular?), whether any resource-level authorization exists (e.g., can a user only edit their *own* post — this is almost certainly true given how post editing is described, but no ownership-check middleware is confirmed in source), or the exact middleware implementation (custom vs. a library).

---

## Database Architecture

```mermaid
erDiagram
    USER ||--o{ POST : creates
    USER ||--o{ MESSAGE : sends
    USER }o--o{ USER : follows
    POST ||--o{ COMMENT : has
    POST ||--o{ REACTION : has
    USER ||--o{ NOTIFICATION : receives
```

✅ **Confirmed**: PostgreSQL via Prisma ORM.

⚠️ **Not documented — this diagram is a hypothesis, not a schema.** No `prisma/schema.prisma` contents were provided, so table names, column definitions, indexes, and actual relations (e.g., is `follows` its own join table or a many-to-many relation field on `User`? are reactions their own table or a composite-keyed join table against `Post` and `User`?) are unverified. The entities and edges above are drawn from the frontend's *feature* list (users create posts, follow other users, send messages, react/comment on posts, receive notifications) — they describe the product's data shape, not the database's. Validate against `prisma/schema.prisma` before treating this as documentation.

---

## Security Architecture

✅ **Confirmed, backend-owned controls:**

- JWT authentication with Access/Refresh tokens in HttpOnly cookies.
- Password hashing via Bcrypt.js — plaintext passwords never persisted.
- Security headers via `Helmet.js`.
- Rate limiting, described as DDoS/brute-force protection (see [Rate Limiting](#rate-limiting) for what's unconfirmed).
- Data sanitization, described as SQL-injection protection.
- CORS configuration, managed in `config/`.
- Centralized error handling, isolating internal error detail from clients.

⚠️ **Not documented**: CSP policy specifics, dependency-audit/SCA tooling (e.g., `npm audit` in CI, Snyk), secrets-management approach beyond `.env`, or a documented threat model. Note also that Prisma's query builder parameterizes queries by default, which is itself a meaningful SQL-injection mitigation — whether the documented "data sanitization" is in addition to that, or is the extent of it, is not specified in source.

---

## Validation Layer

⚠️ **Not documented in source.** Data sanitization is confirmed (SQL-injection framing), but no specific validation library (Joi, Zod, express-validator, class-validator) or schema definitions are shown. 🔍 **Inferred**: given the layered architecture diagram, request validation most plausibly sits in `middleware/` ahead of controllers — but that's an architectural inference from where validation *would* belong, not a confirmed file-level detail.

---

## Error Handling Strategy

✅ **Confirmed**: centralized/global error handling is an explicit documented design goal, implemented as Express error-handling middleware (the natural home for it given the Middleware layer sits between routes and controllers in the architecture diagram).

⚠️ **Not documented**: the actual error-response shape/contract (status codes, message format, whether errors carry a machine-readable code), whether Prisma-specific errors (e.g., unique-constraint violations) are caught and translated into client-friendly messages or leak through as raw database errors, whether errors are classified as operational vs. programmer errors, and whether uncaught exceptions or unhandled promise rejections have process-level handlers (`process.on('uncaughtException', ...)`, etc.).

---

## Logging Strategy

⚠️ **Not documented in source.** No logging library (Winston, Pino, `morgan` for HTTP logs), log destination, or log-level strategy is specified anywhere in the available documentation. This is a real observability gap, not a stylistic omission — without structured logs, diagnosing a production incident means SSH-ing in and reading raw console output, if that's even captured. See [Future Improvements](#future-improvements).

---

## Rate Limiting

✅ **Confirmed to exist**, described as protection against DDoS and brute-force attacks.

⚠️ **Not documented**: which library implements it (`express-rate-limit` is the common default for this stack, but that's a guess, not a confirmed fact), which routes it covers (all routes vs. auth-only — the latter is more common and more likely given the "brute-force" framing specifically calls out login), request thresholds, or window durations. Until this is documented, don't assume `/api/posts` is rate-limited just because `/api/auth/login` almost certainly is.

---

## Real-time Architecture (Socket.IO)

```mermaid
sequenceDiagram
    participant Client
    participant SocketMgr as Socket Manager
    participant DB as PostgreSQL

    Client->>SocketMgr: connect (with auth token)
    SocketMgr->>SocketMgr: verify token
    alt invalid token
        SocketMgr-->>Client: connection rejected
    else valid token
        SocketMgr-->>Client: connection established
        loop live session
            Client->>SocketMgr: emit event (e.g. send message)
            SocketMgr->>DB: persist event data
            SocketMgr-->>Client: broadcast to relevant recipient(s)
        end
    end
```

✅ **Confirmed**: a dedicated `socket/` layer manages WebSocket events for chat and notifications, running alongside (not instead of) the REST controller layer — the architecture diagram shows controllers and the socket manager as siblings, both able to reach the service/data layer.

🔍 **Inferred from frontend service layer**: the frontend's `socketService.ts` and its documented consumers (`ChatBox` for messages/typing, `NotificationBell` for live notification delivery) imply the backend emits at minimum: new-message events, typing-indicator events, and new-notification events. Presence/online-status is also referenced in the frontend's user-search feature ("showing online status"), implying a presence event exists — but none of these event names, payload shapes, or room/namespace conventions are confirmed in backend source.

⚠️ **Not documented**: authentication mechanism for the socket handshake specifically (token in handshake auth payload vs. query string vs. cookie), room/namespace structure, and whether disconnect/reconnect triggers any server-side cleanup (e.g., marking a user offline).

---

## Performance Considerations

✅ **Confirmed capabilities:**
- **Multer**-based file/image upload handling.
- **Socket.IO** for real-time delivery, avoiding polling.
- Layered architecture keeps controllers thin, making later targeted optimization (e.g., service-layer caching) tractable without restructuring.

⚠️ **Not documented**: caching layer (Redis or otherwise), database indexing strategy, connection pooling configuration (Prisma's own connection pool sizing and whether an external pooler like PgBouncer sits in front of it), or any load-testing results. Given PostgreSQL is confirmed but the schema isn't, it's not possible to assess whether common query patterns (e.g., fetching a feed sorted by recency, or a user's follower list) are actually indexed — this is worth checking directly in `prisma/schema.prisma` before scaling traffic.

---

## Scalability Considerations

⚠️ **Not directly documented.** The confirmed stack (JWT auth — stateless-friendly, PostgreSQL, Socket.IO) is *compatible* with horizontal scaling in principle, but none of the following are confirmed: a Socket.IO adapter for multi-instance pub/sub (a **Redis adapter is required**, not optional, the moment you run more than one backend process — raw Socket.IO doesn't fan out broadcasted events across separate Node processes on its own), PostgreSQL connection-pool sizing under concurrent instances (a naive multi-instance deployment can exhaust the database's max-connections limit fast without a pooler), containerization, or a process manager (PM2, etc.) for restart/zero-downtime-deploy handling. Treat single-instance operation as the current, confirmed reality.

---

## Folder Structure

```
backend/
├── config/             # Database connection & CORS configuration
├── controllers/        # Request-handling logic per route
├── middleware/         # Auth, authorization, and error-handling middleware
├── prisma/             # Prisma schema definitions
├── routes/             # API endpoint definitions
├── socket/             # WebSocket event management (Socket.IO)
├── utils/              # Helper functions
├── .env.example        # Required environment variable template
└── server.js           # Application entry point
```

*(✅ Confirmed structure and one-line purpose per folder; internal file-level contents of each folder are not documented — see the domain-specific sections above for what is/isn't known about each.)*

---

## Environment Variables

✅ **Confirmed**: a `.env.example` template exists, and a PostgreSQL connection string is explicitly required.

⚠️ **Not enumerated in source** beyond that. The table below lists what a service with this confirmed feature set (JWT dual-token auth, PostgreSQL via Prisma, CORS-restricted API, file uploads) would need at minimum — treat it as a checklist to verify against the real `.env.example`, not as a confirmed variable list:

| Variable (expected) | Confirmed? | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ Confirmed required | PostgreSQL connection string, e.g. `postgresql://user:password@localhost:5432/mansati` |
| `JWT_ACCESS_SECRET` | ⚠️ Not documented (expected, given dual-token JWT) | Signs access tokens |
| `JWT_REFRESH_SECRET` | ⚠️ Not documented (expected) | Signs refresh tokens |
| `PORT` | ⚠️ Not documented (expected; frontend assumes `5000`) | Server listen port |
| `CORS_ORIGIN` | ⚠️ Not documented (expected, given confirmed CORS config) | Allowed frontend origin(s) |

Consult the repository's actual `.env.example` for the authoritative list before deploying.

---

## Installation & Setup

**Prerequisites**: Node.js LTS (20+), a reachable PostgreSQL instance.

```bash
git clone https://github.com/mohammed-dev-stack/mansati-backend.git
cd mansati-backend
npm install
cp .env.example .env
# edit .env: set DATABASE_URL and any other required variables
npm run dev
```

**Troubleshooting**

| Symptom | Likely cause | Fix |
|---|---|---|
| Server fails to start / crashes immediately | Missing or invalid `DATABASE_URL` | Confirm `.env` is populated and PostgreSQL is reachable from this machine |
| Frontend gets CORS errors | `CORS_ORIGIN` not configured for the frontend's dev URL | Confirm the backend's CORS config allows `http://localhost:3000` (or your frontend's actual origin) |
| Frontend requests get 401 immediately | JWT secret misconfigured, or cookies not being set/read due to origin mismatch | Verify JWT secrets are set and that both apps agree on cookie domain/`SameSite` settings during local dev |
| Real-time features don't connect | Socket.IO server not mounted on the same port as the HTTP server, or `NEXT_PUBLIC_SOCKET_URL` mismatch on the frontend | Confirm the socket manager is initialized against the same `server.js` HTTP server instance |

## Development Workflow

```bash
npm run dev
```

✅ **Confirmed**: this starts the server in development mode. ⚠️ **Not documented**: the exact contents of `npm run dev` (nodemon vs. a custom watch script) or any other `package.json` scripts (test, lint, build, or Prisma-related scripts like `prisma migrate dev` / `prisma generate`) — none were provided in source. The companion frontend expects this service at `http://localhost:5000` by default, so keep ports aligned across both repos during local development.

## Deployment

⚠️ **Not documented in source** — no Dockerfile, CI/CD pipeline, or named hosting target (Render, Railway, a VPS, etc.) is specified. Given the confirmed stack, any real deployment target needs:
- A **persistent Node process**, not a serverless function — the stateful WebSocket connections rule out most serverless platforms as a direct fit.
- A reachable **PostgreSQL instance** (a managed provider or self-hosted), with `prisma migrate deploy` run against it as part of the deployment step.
- **CORS/env configuration** pointed at the deployed frontend's actual origin, not `localhost`.

Document the real target once confirmed — this section should not be treated as deployment instructions today.

## Monitoring Considerations

⚠️ **Not documented in source.** No APM integration, health-check endpoint, or uptime monitoring is specified. A `GET /health` or `GET /api/status` endpoint returning process uptime and DB-connection status would be a reasonable, low-effort near-term addition — see [Future Improvements](#future-improvements).

## Future Improvements

📋 **Planned / recommended next steps**, inferred from the documented gaps above (not a stated roadmap — the source provides none for the backend specifically):

- [ ] Publish full API documentation (OpenAPI/Swagger) covering the complete route set beyond the 5 confirmed endpoints.
- [ ] Document the Prisma schema and its actual table relations.
- [ ] Add structured logging (Winston/Pino) with log levels and a shipping destination.
- [ ] Add a `/health` endpoint and basic process/DB-connection monitoring.
- [ ] Document rate-limit thresholds and confirm route coverage.
- [ ] Add a Redis-backed Socket.IO adapter before scaling beyond a single instance.
- [ ] Add automated tests (unit + integration) and a CI pipeline.
- [ ] Resolve the token-storage documentation mismatch with the frontend repository (HttpOnly cookie vs. `sessionStorage`).
- [ ] Document the validation library and strategy in use.
- [ ] Define and document the error-response contract, including how Prisma errors are translated for clients.

## Contributing Guide

⚠️ **Not documented for this repository specifically** — the frontend repo documents a standard fork → branch → implement → PR flow; apply the same convention here until a backend-specific contributing guide exists:

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/your-feature`.
3. Implement the change, following the existing layered pattern (routes → middleware → controllers → services → Prisma) — business logic belongs in services, not controllers.
4. Add tests if a test suite exists in the repository (none is confirmed as of this writing).
5. Open a PR describing the change and, if it touches the API surface or schema, which endpoints or tables are affected.

## License

MIT — see `LICENSE` for full terms.

## Author & Contact

**Mohammed Qannan**
Full-Stack Developer — Node.js/Express and PostgreSQL on the backend, Next.js/React/TypeScript on the frontend, with a layered-architecture discipline applied on both sides.

**Project links**
- Backend repository: https://github.com/mohammed-dev-stack/mansati-backend
- Frontend repository: https://github.com/mohammed-dev-stack/mansati-frontend
