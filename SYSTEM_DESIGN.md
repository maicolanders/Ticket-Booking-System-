# System Design — Ticket Booking System

## Overview

A monorepo (npm workspaces) with three packages: a stateless **Express + Socket.io REST API**, a **React (Vite) SPA**, and a **shared** TypeScript package holding the enums, DTOs, and Zod schemas that both sides import — so the wire contract is defined once and typechecked end-to-end. **PostgreSQL** (via Prisma) is the single source of truth; the API is horizontally stateless apart from an in-process TTL sweeper.

## Data model: one row per seat per show

The pivotal decision is `ShowSeat`: when a show is created, the venue's physical seat template (`VenueSeat`) is snapshotted into one `ShowSeat` row per seat, each carrying a `status` (`AVAILABLE | HELD | BOOKED`). A `@@unique([showId, venueSeatId])` constraint means a seat **cannot** exist twice for a show — double-selling is structurally impossible at the schema level, before any application logic runs. Pricing is per-show-per-category (`ShowPricing`) and the price paid is copied onto `BookingSeat` at purchase, so later price edits never rewrite history.

## Concurrency: pessimistic row locks

Holding seats is the contested path. `POST /shows/:id/holds` runs a Prisma **interactive transaction** that first issues `SELECT … WHERE id IN (…) FOR UPDATE` on the target `ShowSeat` rows. Two customers racing for the same seat serialize on that lock: the first transaction flips the rows to `HELD` and commits; the second blocks, then reads `HELD` and returns **409 Conflict**. Booking and cancellation re-lock the same rows the same way, so they cannot race the sweeper or each other. Because correctness rests on the unique constraint *plus* the lock, even an unexpected interleaving cannot oversell.

## Seat holds + TTL auto-release

A hold groups the seats of one checkout and carries `expiresAt = now + HOLD_TTL_SECONDS` (default 600s). Expiry is handled two ways:

1. **Background sweeper** — a `setInterval` job (every `SWEEP_INTERVAL_SECONDS`) finds `ACTIVE` holds past `expiresAt`, returns their seats to `AVAILABLE`, marks the hold `EXPIRED`, and emits realtime updates. It skips overlapping runs and is `unref`'d so it never keeps the process alive.
2. **Lazy expiry** — hold and booking attempts treat any stale hold on the seats they touch as already released, inside the same locked transaction. This is the backstop if the sweeper lags, and it makes correctness independent of timer precision.

Abandoning checkout also releases eagerly via `DELETE /holds/:id`. (A pure-DB alternative — a `pg_cron` job running the same SQL — is noted in the README.)

## Waitlist: FIFO offers with re-offer

Each `WaitlistEntry` is FIFO by `createdAt`, scoped to a show + seat category. On cancellation, freed seats are handed to the waitlist **one at a time**. For each seat, a transaction locks it, then selects the next `WAITING` entry with `FOR UPDATE SKIP LOCKED` — `SKIP LOCKED` prevents two concurrent offer flows from handing the same person two seats. A `WaitlistOffer` is created with its own TTL, the seat is parked in `HELD` (reserved, but tied to no checkout hold), the entry moves to `OFFERED`, and a **time-limited link is emailed**. The offeree accepts (`POST /waitlist/offers/:token/accept`) before expiry to convert directly into a booking. If the offer lapses, the sweeper expires it, drops that entrant, and **re-offers the seat to the next in line** — or releases it to `AVAILABLE` if the queue is empty. This is why offers are issued serially per seat: it preserves fairness under churn.

## Real-time seat map

Clients join a Socket.io room per show. Every seat transition (`held`, `released`, `booked`, `offered`) broadcasts the affected seat ids and new status; the SPA patches its TanStack Query cache in place, so open seat maps update live without polling. The initial `GET /shows/:id/seats` also returns a `heldByMe` flag so a returning user sees their own hold distinctly.

## Tickets: QR + email

Confirming a booking mints a `qrToken` — a **signed JWT** over the booking reference (`{ref, kind:'ticket'}`) using the same secret as auth. The QR encodes that JWT; the ticket email embeds it. Gate verification (`GET /tickets/verify`) re-verifies the signature cryptographically and then checks the booking is still `CONFIRMED`, so a tampered or cancelled ticket fails. Email goes through a provider-agnostic mailer: **Resend** in production, an **Ethereal** sandbox (prints a preview URL) when no API key is set, so the whole flow runs offline in dev and never blocks a booking on mail delivery.

## Trade-offs

Pessimistic locking (vs optimistic retries) is the right call for a small, hot contended set of rows and keeps the logic obvious. The in-process sweeper is simplest for a single always-on instance; at multi-instance scale it would move to `pg_cron` or a leader-elected worker. Payment is a deliberate stub — confirmation equals paid. Auth is stateless JWT; roles (`CUSTOMER | ORGANISER | ADMIN`) gate routes via middleware.
