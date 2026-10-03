# 🎟️ Ticket Booking System

> **This repository is the starting point for the Durable Functions assessment. Start with [CANDIDATE.md](CANDIDATE.md).**

A full-stack ticket-booking platform for **movies and concerts** with seat-level
inventory, concurrency-safe holds, a time-limited waitlist offer flow, live seat
maps, and QR-code tickets delivered by email.

Built as a TypeScript monorepo: a **REST API** (Express + Socket.io + Prisma +
PostgreSQL) and a **React SPA** (Vite + Tailwind), sharing one typed contract.

> Design rationale for the hard parts (concurrency, TTL, waitlist) lives in
> **[SYSTEM_DESIGN.md](SYSTEM_DESIGN.md)**. The checkout re-implemented on Azure
> Durable Functions is designed in **[DESIGN.md](DESIGN.md)**; operating it is
> covered by **[RUNBOOK.md](RUNBOOK.md)**.

---

## Feature checklist

| Requirement | Where |
|---|---|
| **Seat hold with configurable TTL** (default 600s) | `HOLD_TTL_SECONDS`, `holds.service.ts` |
| **Auto-release** on checkout abandonment / expiry | sweeper job + lazy expiry + `DELETE /holds/:id` |
| **Concurrency protection** — no double-hold / double-book | `SELECT … FOR UPDATE` + `@@unique([showId, venueSeatId])` |
| **Waitlist per seat category** when sold out | `WaitlistEntry` (FIFO) |
| **Auto-assignment + time-limited emailed offer** on cancellation | `waitlist.service.ts`, re-offers to next in line on lapse |
| **Per-show seat map as a live visual grid** | `SeatMap.tsx` + Socket.io room per show |
| **QR-code ticket generated on booking + emailed** | signed-JWT QR, Resend / SMTP / Ethereal mailer |
| **Role-based auth** — customer / organiser / admin | JWT + `requireRole` middleware |
| Admin: venues, seat layouts, categories | `/admin/venues`, venue editor |
| Organiser: events, shows, per-category pricing, revenue summary | `/organiser`, event summary |
| Customer: browse/filter, book, history, cancel | browse → seat map → checkout → history |

---

## Tech stack

- **API** — Node 22 or 24, TypeScript (ESM), Express 4, Prisma 5, Socket.io 4, Zod,
  JWT (`jsonwebtoken`) + `bcryptjs`, `qrcode`, Resend + Nodemailer.
- **Web** — React 18, Vite 6, Tailwind CSS 3, React Router 6, TanStack Query 5,
  axios, socket.io-client.
- **Shared** — enums, DTOs, and Zod schemas imported by both sides.
- **DB** — PostgreSQL 17 (Docker Compose locally).

---

## Monorepo layout

```
Ticket_Booking/
├── package.json            # npm workspaces + top-level scripts
├── docker-compose.yml      # PostgreSQL, simulator, Mailpit, DTS, and Azurite
├── .env.example            # every env var, documented
├── README.md · SYSTEM_DESIGN.md
└── packages/
    ├── shared/  src/index.ts          # enums, DTOs, Zod schemas, socket events
    ├── domain/                        # checkout business rules + persistence (shared by api and functions)
    │   ├── prisma/{schema.prisma, migrations/}
    │   └── src/db/client.ts           # the single Prisma client
    ├── functions/                     # Checkout API: Azure Durable Functions on DTS
    │   ├── host.json · local.settings.example.json
    │   └── src/{http, orchestrators, activities, timers}
    ├── payment-sim/                   # local external payment provider
    ├── acceptance/                    # Checkout API acceptance tests (public + failure scenarios)
    ├── api/
    │   ├── prisma/seed.ts              # demo data
    │   └── src/
    │       ├── app.ts · index.ts · config/env.ts
    │       ├── lib/    {jwt, mailer, qr, money, ids, errors, …}
    │       ├── middleware/ {auth, validate, error}
    │       ├── modules/ {auth, venues, events, shows, seats, holds,
    │       │             bookings, waitlist, reports, tickets}
    │       ├── realtime/io.ts          # Socket.io wiring
    │       └── jobs/sweeper.ts         # TTL sweeper
    └── web/  src/{pages, components, api, auth, realtime, lib}
```

---

## Prerequisites

- **Node.js 22 or 24** and **npm ≥ 10**
- **Docker**
- **Azure Functions Core Tools v4**

---

## Quick start (local)

```bash
# 1. Check local tools, then install all workspaces
npm run doctor
npm ci --registry=https://registry.npmjs.org

# 2. Start the local infrastructure and verify it
npm run infra:up
npm run doctor

# 3. Configure env (defaults already match docker-compose)
cp packages/domain/.env.example packages/domain/.env
cp packages/api/.env.example packages/api/.env
cp packages/web/.env.example packages/web/.env
cp packages/functions/local.settings.example.json packages/functions/local.settings.json

# 4. Generate Prisma Client, apply the schema, and load demo data
npm run db:generate
npm run db:deploy      # or: npm run db:migrate  (creates/repeats migrations)
npm run db:seed

# 5. Run API (:4000) and web (:5173) together
npm run dev

# 6. In another terminal: the Checkout API (Functions, :7071) on the DTS emulator
npm run start:functions
```

The Checkout API is at **http://localhost:7071/api/checkouts** and uses the
legacy API's JWTs (`POST /api/auth/login`). `start:functions` builds and then
starts the host; stop the host before rebuilding (a rebuild empties `dist/`
under a running host). Its JSON logs go to stdout; keep them for tracing with
`npm run start:functions 2>&1 | tee functions.log`.

Open **http://localhost:5173**. The API is at **http://localhost:4000** (health:
`GET /api/health`).

Local email is captured by **Mailpit at http://localhost:8025**. Durable Task
Scheduler instances are visible in the **DTS dashboard at http://localhost:8082**.

| Service | Host ports |
|---|---|
| API / web | 4000 / 5173 |
| PostgreSQL | 5433 |
| Payment simulator | 4100 |
| Mailpit SMTP / UI | 1025 / 8025 |
| DTS emulator gRPC / dashboard | 8080 / 8082 |
| Azurite blob / queue / table | 10000 / 10001 / 10002 |

---

## Demo accounts

Seeded by `npm run db:seed` (password for **all**: `password123`):

| Role | Email | Notes |
|---|---|---|
| Admin | `admin@ticket.dev` | Manages venues, categories, seat layouts |
| Organiser | `organiser@ticket.dev` | Owns the seeded movie + concert, per-category pricing, revenue summary |
| Customer | `alice@ticket.dev` | Holds the **Premium** booking on *Interstellar* (show #1) |
| Customer | `bob@ticket.dev` | Waitlisted **#1** for that Premium category |
| Customer | `carol@ticket.dev` | Waitlisted **#2** |

**Try the waitlist flow end-to-end:** log in as **Alice** → *My Bookings* →
cancel her Premium booking. A freed seat is instantly offered to **Bob**; the API
log prints his offer email (with the `/waitlist/offer/:token` link). Log in as Bob
and accept before the offer TTL to convert it into a booking. Let it lapse instead
and the sweeper re-offers the seat to **Carol**.

---

## Environment variables

Full reference in **[.env.example](.env.example)**. Summary:

### API (`packages/api/.env`)
| Var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://ticket:ticket@localhost:5433/ticketing?schema=public` | PostgreSQL connection |
| `PORT` | `4000` | API HTTP port |
| `JWT_SECRET` | `change-me-to-a-long-random-secret` | Signs auth **and** QR ticket tokens — set a strong value in prod |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed web origin(s), comma-separated |
| `APP_BASE_URL` | `http://localhost:5173` | Web base URL used to build emailed offer links |
| `HOLD_TTL_SECONDS` | `600` | Seat-hold lifetime |
| `WAITLIST_OFFER_TTL_SECONDS` | `600` | Waitlist-offer lifetime |
| `SWEEP_INTERVAL_SECONDS` | `15` | How often the TTL sweeper runs |
| `RESEND_API_KEY` | *(empty)* | Set to send via Resend; otherwise `SMTP_URL`, then Ethereal |
| `SMTP_URL` | `smtp://localhost:1025` | SMTP transport used when Resend is not configured |
| `MAIL_FROM` | `Ticket Booking <onboarding@resend.dev>` | From address |
| `PAYMENT_API_URL` | `http://localhost:4100` | Payment simulator base URL |
| `PAYMENT_TIMEOUT_MS` | `10000` | Payment HTTP timeout |

### Web (`packages/web/.env`)
| Var | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | `http://localhost:4000` | REST base (client calls `${VITE_API_URL}/api`) |
| `VITE_SOCKET_URL` | `http://localhost:4000` | Socket.io endpoint |
| `VITE_CHECKOUT_API_URL` | `http://localhost:7071/api` | Checkout API (Functions); the SPA checks out through it |

### Checkout API (`packages/functions/local.settings.json`)
| Setting | Default | Purpose |
|---|---|---|
| `DURABLE_TASK_SCHEDULER_CONNECTION_STRING` | `Endpoint=http://localhost:8080;TaskHub=default;Authentication=None` | DTS emulator (an Azure DTS resource in production) |
| `TASKHUB_NAME` | `default` | Task hub used by `host.json` |
| `AzureWebJobsStorage` | `UseDevelopmentStorage=true` | Azurite (host locks, timer trigger) |
| `DATABASE_URL`, `JWT_SECRET` | as the API | Same database; same secret so the API's JWTs validate |
| `HOLD_TTL_SECONDS` | `600` | Checkout hold lifetime (`10` for the acceptance suite) |
| `CHECKOUT_RECOVERY_GRACE_SECONDS` | `120` | How long past expiry before the recovery timer expires an orphaned checkout |
| `PAYMENT_API_URL`, `PAYMENT_TIMEOUT_MS` | `http://localhost:4100`, `10000` | Payment simulator; the timeout must exceed the provider's slowest processing |
| `SMTP_URL`, `MAIL_FROM`, `RESEND_API_KEY` | Mailpit | Ticket email |
| `Host.CORS` | `http://localhost:5173` | Lets the SPA call the Checkout API locally |

---

## Database schema

PostgreSQL via Prisma (`packages/domain/prisma/schema.prisma`). Core entities:

| Model | Purpose | Key constraints |
|---|---|---|
| `User` | Accounts with `role` ∈ {CUSTOMER, ORGANISER, ADMIN} | `email` unique |
| `Venue` | Physical venue (admin-owned) | |
| `SeatCategory` | Priceable tier per venue (Premium/Standard/…) + color | |
| `VenueSeat` | One physical seat in a venue's layout template | `@@unique([venueId, rowLabel, colNumber])` |
| `Event` | A movie or concert (organiser-owned), `type` ∈ {MOVIE, CONCERT} | |
| `Show` | A screening/performance = event + venue + datetime | |
| `ShowPricing` | Price per seat category **per show** | `@@unique([showId, seatCategoryId])` |
| **`ShowSeat`** | **One row per physical seat per show** — the live status source of truth (`AVAILABLE/HELD/BOOKED`) | **`@@unique([showId, venueSeatId])`** ← makes double-selling impossible |
| `Hold` | Groups the seats of one checkout; `expiresAt`, `status` | indexed `[status, expiresAt]` for the sweeper |
| `Booking` / `BookingSeat` | Confirmed purchase; price copied per seat at booking time | `reference` unique; holds `qrToken` |
| `WaitlistEntry` | FIFO queue per show + seat category | indexed `[showId, seatCategoryId, status, createdAt]` |
| `WaitlistOffer` | Time-limited offer of a freed seat to the next entrant | `offerToken` unique |

When a show is created, the venue's `VenueSeat`s are **snapshotted** into `ShowSeat`
rows (all `AVAILABLE`), so each show has independent inventory.

A ready-to-apply initial migration is committed at
`packages/domain/prisma/migrations/0_init/` — `npm run db:deploy` applies it.

---

## API reference

Base path `/api`. Auth is a **Bearer JWT** (`Authorization: Bearer <token>`) from
register/login. Roles: 🟢 public · 🔵 any authenticated · 🟠 organiser · 🔴 admin ·
🟣 organiser+admin.

### Auth — `/api/auth`
| Method | Path | Access | Body / notes |
|---|---|---|---|
| POST | `/register` | 🟢 | `{ email, password, name, role? }` (role ∈ CUSTOMER\|ORGANISER) → `{ token, user }` |
| POST | `/login` | 🟢 | `{ email, password }` → `{ token, user }` |
| GET | `/me` | 🔵 | current user |

### Venues — `/api/venues`
| Method | Path | Access | Body / notes |
|---|---|---|---|
| GET | `/` | 🔵 | list venues (with counts) |
| GET | `/:id` | 🔵 | venue + categories + seats |
| POST | `/` | 🔴 | `{ name, address }` |
| POST | `/:id/categories` | 🔴 | `{ name, color? }` |
| POST | `/:id/seats` | 🔴 | `{ sections: [{ categoryId, rowLabels[], seatsPerRow }] }` — grid generator |

### Events & shows — `/api/events`
| Method | Path | Access | Body / notes |
|---|---|---|---|
| GET | `/` | 🟢 | filters: `?type&search&venueId&date` |
| GET | `/mine` | 🟠 | organiser's own events |
| GET | `/:id` | 🟢 | event + its shows |
| GET | `/:id/summary` | 🟠 | bookings + revenue + occupancy per show/category |
| POST | `/` | 🟠 | `{ title, description?, type, imageUrl?, genre? }` |
| POST | `/:id/shows` | 🟠 | `{ venueId, startsAt(ISO), endsAt?, pricing: [{ seatCategoryId, price }] }` |

### Shows, seats, holds, waitlist — `/api/shows`
| Method | Path | Access | Body / notes |
|---|---|---|---|
| GET | `/:id` | 🟢 | show detail |
| GET | `/:id/seats` | 🟢* | full seat map; `heldByMe` set if authenticated |
| POST | `/:id/holds` | 🔵 | `{ seatIds: [] }` → `HoldDTO` (409 if any taken) |
| POST | `/:id/waitlist` | 🔵 | `{ seatCategoryId }` → waitlist entry |
| GET | `/:id/waitlist/me` | 🔵 | my active entries + positions + live offer |

### Holds / Bookings / Waitlist / Tickets
| Method | Path | Access | Body / notes |
|---|---|---|---|
| DELETE | `/api/holds/:id` | 🔵 | release a hold early (idempotent) |
| POST | `/api/bookings` | 🔵 | `{ holdId, paymentToken }` → charge, confirm booking, mint QR, email ticket |
| GET | `/api/bookings` | 🔵 | booking history |
| GET | `/api/bookings/:reference` | 🔵 | booking detail incl. `qrDataUrl` |
| POST | `/api/bookings/:id/cancel` | 🔵 | cancel → frees seats → triggers waitlist offers |
| GET | `/api/waitlist/offers/:token` | 🔵 | offer detail (owner-only) |
| POST | `/api/waitlist/offers/:token/accept` | 🔵 | accept offer → booking + QR email |
| DELETE | `/api/waitlist/:id` | 🔵 | leave the waitlist (WAITING entries only) |
| GET | `/api/tickets/verify?token=` | 🟣 | gate verification of a scanned QR |
| GET | `/api/tickets/:reference/qr` | 🔵 | QR data URL for an owned booking |

Errors are JSON `{ error, details? }` with conventional status codes (400
validation, 401/403 auth, 404 missing, **409 seat conflict**, 410 expired hold/offer).

---

## Seat-hold, concurrency & TTL logic

**Holding** (`POST /shows/:id/holds`) runs in a Prisma interactive transaction that
`SELECT … FOR UPDATE`s the target `ShowSeat` rows. Concurrent requests for the same
seat **serialize** on the row lock — the first wins and flips them to `HELD`; the
rest see `HELD` and get **409**. Combined with `@@unique([showId, venueSeatId])`
(one row per seat), overselling is structurally impossible. Booking and cancellation
re-lock the same rows, so they never race the sweeper.

**Auto-release** happens three ways:
1. **Sweeper** (`jobs/sweeper.ts`) every `SWEEP_INTERVAL_SECONDS`: expired `ACTIVE`
   holds → seats back to `AVAILABLE`, hold → `EXPIRED`, realtime `seat:released`.
2. **Lazy expiry**: any stale hold encountered during a hold/booking attempt is
   treated as released within that same locked transaction (backstop if the sweeper
   lags — correctness never depends on timer precision).
3. **Explicit**: `DELETE /holds/:id` when the user leaves checkout.

> **Pure-DB alternative:** the sweeper's work is a couple of `UPDATE … WHERE
> expiresAt < now()` statements, so it can be replaced by a **`pg_cron`** job with
> zero app changes — useful for multi-instance deployments.

## Waitlist offer flow

When a booking is cancelled, each freed seat is offered **one at a time** to keep
FIFO fair:

1. Lock the seat; pick the next `WAITING` entry for its category with
   `FOR UPDATE SKIP LOCKED` (so two concurrent flows can't hand one person two seats).
2. Create a `WaitlistOffer` (`WAITLIST_OFFER_TTL_SECONDS`), park the seat as `HELD`,
   move the entry to `OFFERED`, and **email a time-limited link** to
   `/waitlist/offer/:token`. Broadcast `seat:offered`.
3. The offeree **accepts** before expiry → the seat converts straight to a booking
   (QR emailed). Nobody waiting → the seat is released to `AVAILABLE`.
4. If the offer **lapses**, the sweeper expires it, drops that entrant, and
   **re-offers** the seat to the next in line (or releases it).

## Real-time seat map

The SPA joins a Socket.io room per show and patches its TanStack Query cache on
`seat:held | seat:released | seat:booked | seat:offered`, so every open seat map
updates live. Event names + payload shape live in `@ticket/shared` (`SocketEvents`).

## QR tickets & email

On confirmation the booking gets a `qrToken` — a **signed JWT** over its reference
(`{ ref, kind: 'ticket' }`). The QR encodes that JWT and the ticket email embeds it.
`GET /api/tickets/verify` re-verifies the signature and checks the booking is still
`CONFIRMED`, so tampered or cancelled tickets are rejected. Email uses **Resend**
when `RESEND_API_KEY` is set, otherwise `SMTP_URL` (Mailpit locally), then an
**Ethereal** dev inbox (preview URL logged);
mail failures never block a booking in dev.

---

## Testing

Run `npm run infra:up` first. One command per level:

| Level | Command | What it covers | Needs |
|---|---|---|---|
| Unit | `npm run test:unit` | Every branch of the checkout saga: the orchestrator generator driven by a scripted fake Durable context (no host, no DB) | nothing |
| Integration | `npm run test:integration` | `@ticket/domain` against real PostgreSQL and the payment simulator: locks, lock timeouts and retries, idempotency of every checkout step, contention, pricing, payment gateway outcomes, ticket delivery, recovery | infra |
| Legacy API | `npm test` | The original in-process API suite (holds, TTL, waitlist) plus legacy payment and checkout-guard tests | infra |
| Simulator | `npm run test:sim` | The payment provider in isolation | nothing |
| Acceptance | `npm run test:acceptance` | Black-box Checkout API: the public contract suite plus failure scenarios (concurrent payments, `tok_flaky`, `tok_timeout`, cancel during payment, seat contention, 401/400/404/409) | infra, legacy API, Functions app with `HOLD_TTL_SECONDS=10` |
| Restart drill | `npm run test:restart` | SIGKILLs the Functions host mid-charge, restarts it, and checks one charge and a CONFIRMED checkout | infra, seeded legacy API, port 7071 **free** (it runs its own host) |

For the acceptance level, start the Functions app with a short hold so the expiry
scenario runs quickly:

```bash
HOLD_TTL_SECONDS=10 npm run start:functions   # environment overrides local.settings.json
npm run test:acceptance
```

Every guarantee claimed in [DESIGN.md](DESIGN.md#failure-modes) names the test that
demonstrates it.

---

## Secret hygiene

Real credentials never belong in the repo. Two safeguards keep them out:

- **`.gitignore`** ignores every `.env` variant (`.env`, `.env.*`) plus key/cert
  material — only the redacted `*.example` templates are tracked. Your real
  `packages/api/.env` stays on your machine.
- A **pre-commit guard** ([`scripts/git-hooks/pre-commit`](scripts/git-hooks/pre-commit))
  refuses to commit a real `.env` file and scans staged changes for live-looking
  tokens (Resend / OpenAI / GitHub / AWS / Slack keys, private-key blocks, JWTs).
  Override a false positive with `git commit --no-verify`.

Git does **not** clone `.git/hooks/`, so re-install the guard after cloning:

```bash
cp scripts/git-hooks/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
```

In production, set secrets as environment variables in the hosting platform,
never in a committed file.

---

## Top-level scripts

| Script | Does |
|---|---|
| `npm run dev` | API + web together (concurrently) |
| `npm run build` | Generate the Prisma client, build API (tsup) + web (vite) |
| `npm start` | Start built API |
| `npm run start:functions` | Build and start the Checkout API (Functions host on :7071) |
| `npm run db:generate` | `prisma generate` (regenerate the Prisma client) |
| `npm run db:migrate` | `prisma migrate dev` (create/apply migrations) |
| `npm run db:deploy` | `prisma migrate deploy` (apply committed migrations) |
| `npm run db:seed` | Load demo data |
| `npm run db:reset` | Drop, re-migrate, re-seed |
| `npm run test:unit` | Checkout orchestrator unit tests |
| `npm run test:integration` | Domain integration tests (PostgreSQL, simulator) |
| `npm test` | API test suite |
| `npm run test:sim` | Payment simulator suite |
| `npm run test:acceptance` | Checkout API acceptance suites |
| `npm run test:restart` | Functions host crash/restart drill |
| `npm run infra:up` | Start and wait for all local infrastructure |
| `npm run infra:down` | Stop local infrastructure |
| `npm run infra:reset` | Stop infrastructure and remove its volumes |
| `npm run doctor` | Check tools, container health, and local ports |
| `npm run lint` | Typecheck the API |

---

## Notes & non-goals

- Payments use the local external simulator described in `packages/payment-sim/README.md`.
- The seat-layout editor is a pragmatic **grid generator** (rows × seats-per-row per
  category), not full drag-and-drop.
- Admins are **seeded**, not self-registerable; customers and organisers self-register.
- The TTL sweeper is in-process (fine for one always-on instance); see the `pg_cron`
  note above for horizontal scale.
