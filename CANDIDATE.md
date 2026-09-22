# Durable Functions assessment

## Welcome and timebox

Expect one to two days of focused work. We value engineering judgement over feature coverage. Submit a coherent, well-tested design, and tell us what you would do with more time.

## The system today

This repository contains an Express API, React SPA, PostgreSQL database, and shared TypeScript contracts. Customers select seats, create time-limited holds, confirm bookings, and receive QR tickets by email. PostgreSQL row locks protect seat transitions; an in-process job and lazy checks expire holds. A separate local process simulates an external payment provider. See [README.md](README.md) for setup and [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) for the existing design.

## Your task

Re-implement the checkout critical path as an Azure Durable Functions app and refactor the existing codebase so the old and new parts form one coherent system. The critical path is seat selection through hold, payment, booking confirmation, and ticket delivery, including hold expiry and customer cancellation.

We assess five equally weighted criteria:

1. Refactoring existing code.
2. Testing and observability.
3. Durable Functions and Durable Task Scheduler fluency.
4. Saga and compensation design.
5. Transaction locks and retry behaviour.

Durable Functions is the setting in which all five are judged, not the sole goal.

## Hard requirements

### Platform (F)

**F1.** Use TypeScript with `strict` enabled, the Azure Functions Node.js programming model v4, and `durable-functions` version 3.5.0 or later. The standalone Durable Task SDK is not permitted.

**F2.** Use Durable Task Scheduler as the orchestration backend: the emulator locally and `storageProvider.type = "azureManaged"`. Other Durable Functions backends are not permitted.

**F3.** Implement the Checkout API contract below exactly. It must run locally with `docker compose` plus documented commands and require no Azure subscription.

### Refactoring (R)

**R1.** The business rules checkout depends on must exist in one place and be used by both the legacy API and the Functions app: seat state transitions, pricing, hold validity, and booking creation. Copying service code into the Functions app does not meet this requirement.

**R2.** Every legacy feature outside checkout must keep working: auth, browsing, venue and show management, booking history, cancellation, and the waitlist. For every legacy checkout-related endpoint and background job, decide whether to remove it, delegate it to the new flow, or keep it, and justify each decision.

**R3.** The existing test suite must pass against your refactored code. Justify every changed or removed test in `DESIGN.md`. Commit in small, meaningful steps because we read your history.

### Correctness, locks and retries (L)

**L1.** A seat can never be sold twice under concurrency, retries, and process restarts.

**L2.** PostgreSQL remains the system of record. Payments go only through the payment simulator's HTTP API.

**L3.** Every operation that may be retried is safe to repeat. Every transient failure you handle has a bounded retry policy.

### Testing and observability (T)

**T1.** Automated tests must demonstrate every guarantee claimed in `DESIGN.md`, including concurrency and failure paths. A claimed guarantee without a test counts for less.

**T2.** Each checkout has one correlation ID. It must appear in every log line related to that checkout and in the status response, and it must be sent to the payment simulator as `X-Correlation-Id` on every call.

**T3.** The Functions app writes structured JSON logs.

## What you decide

You decide:

- the project and package layout and the structure of shared domain code,
- what happens to every legacy endpoint and background job,
- data-model changes,
- orchestration structure and instance IDs,
- where locks are taken and which isolation levels and timeouts apply,
- retry layers and policies.

These decisions are a large part of what we evaluate. Explain them in `DESIGN.md`.

## Deliverables

**D1.** Your code with its incremental Git history intact. The submitted repository must preserve that history.

**D2.** `DESIGN.md` with these sections:

- **Overview**, with a diagram.
- **Refactoring:** what moved where and why, and what was removed, delegated, or kept from the legacy checkout path and jobs.
- **Orchestration design:** orchestrations, activities, timers, events, instance IDs, custom status, and lifecycle.
- **Compensation matrix:** for every step, the forward action, compensation, source of its idempotency key, and handling of an unknown outcome.
- **Transaction inventory:** for every database transaction, its owning activity, isolation level, rows locked and order, lock or statement timeout, and behaviour on deadlock, serialization failure, and lock timeout.
- **Retry policy table:** for every activity and external call, the retrying layer, attempts, backoff, and retryable versus non-retryable errors.
- **Failure modes:** each failure mode considered and the test that covers it.
- **Observability:** how an operator traces one checkout end to end and finds stuck instances.
- **More time:** what you would do with it.
- **Deviations** from the requirements.

**D3.** Tests, with one command per test level and a short README section explaining the levels.

**D4.** `RUNBOOK.md`, about a page, explaining how to diagnose a stuck or failed checkout with example commands and queries.

**D5.** A video walkthrough of five minutes or less.

**Optional but desirable:** the complete chat log from AI-assisted development, if you used AI tools.

## Checkout API contract

The contract is served by the candidate's Functions app.

- **Auth.** Requests send `Authorization: Bearer <JWT>`, where the JWT is issued by the existing `POST /api/auth/login`. The app validates it with the same `JWT_SECRET` and returns 401 otherwise.
- **Hold duration.** The hold TTL is read from `HOLD_TTL_SECONDS`.
- **Payment metadata.** Every charge created for a checkout must carry `metadata.checkoutId`.
- **Correlation.** Every simulator call for a checkout must send `X-Correlation-Id` equal to that checkout's `correlationId`.

| Method and path | Body | Success | Errors |
|---|---|---|---|
| `POST /checkouts` | `{ showId, seatIds: string[] }` (1+) | 202 `{ checkoutId, statusUrl }`, where `statusUrl` is the URL of `GET /checkouts/{checkoutId}` | 400, 401 |
| `GET /checkouts/{checkoutId}` | none | 200 `{ checkoutId, correlationId, status, seatIds, holdExpiresAt, amountDue, bookingReference, failureReason, updatedAt }`; unused fields are `null`, `amountDue` is in minor units | 401; 404 if unknown or not owned by the caller |
| `POST /checkouts/{checkoutId}/payment` | `{ paymentToken }` | 202 | 409 if not payable. Repeated or concurrent calls must never cause more than one net charge |
| `POST /checkouts/{checkoutId}/cancel` | none | 202 | 409 if the checkout is already terminal |

**Statuses:**

| Status | Meaning | Terminal? |
|---|---|---|
| `PENDING` | Accepted, hold not yet attempted | No |
| `REJECTED` | Seats unavailable | Yes |
| `AWAITING_PAYMENT` | Seats held until `holdExpiresAt` | No |
| `EXPIRED` | The hold lapsed without payment | Yes |
| `CANCELLED` | The customer cancelled | Yes |
| `PROCESSING_PAYMENT` | Payment submitted, outcome pending | No |
| `CONFIRMED` | Booking committed | Yes |
| `PAYMENT_DECLINED` | Payment refused | Yes |
| `REFUNDED` | Charged, but the booking couldn't be completed, so the charge was refunded | Yes |
| `FAILED` | Requires operator intervention; `failureReason` is set | Yes |

**Guarantees the contract promises:**

- `CONFIRMED` means exactly one net succeeded charge equal to `amountDue`, and a ticket email is eventually delivered.
- Every other terminal status except `FAILED` means zero net charge (charges minus refunds).
- A seat is never `BOOKED` for two checkouts.

## How we evaluate

Each criterion is worth 20%: refactoring existing code, testing and observability, Durable Functions and DTS fluency, saga and compensation design, and transaction locks and retry behaviour.

We read your code, tests, commit history, and `DESIGN.md`. We also run your solution against additional automated scenarios, including failure injection, lock contention, and process restarts.

## Bonus

A strong submission does not require bonus work:

- orchestrate the waitlist offer flow,
- deploy to Azure with DTS on a justified Azure Functions SKU (DTS supports any Functions SKU), preferably with infrastructure as code and no committed secrets,
- add OpenTelemetry or Application Insights,
- update the SPA to use the new flow.

## Reference material

- [TypeScript Durable Functions quickstart with DTS](https://learn.microsoft.com/en-us/azure/durable-task/durable-functions/quickstart-js-vscode)
- [Durable Task Scheduler](https://learn.microsoft.com/en-us/azure/durable-task/scheduler/durable-task-scheduler)
- [`durable-functions` API reference](https://learn.microsoft.com/en-us/javascript/api/durable-functions/)
- [`durable-functions` releases](https://github.com/Azure/azure-functions-durable-js/releases)
- [DTS samples repository](https://github.com/Azure-Samples/Durable-Task-Scheduler), including `samples/durable-functions/typescript/HelloCities` and `samples/durable-functions/typescript/CriticalSections`
- [Orchestrator code constraints](https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-code-constraints)
- [Error handling and retries](https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-error-handling)
- [Durable timers](https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-timers)
- [External events](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-external-events)
- [Instance management](https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-instance-management)
- [HTTP API](https://learn.microsoft.com/en-us/azure/durable-task/durable-functions/durable-functions-http-api)
- [Diagnostics](https://learn.microsoft.com/en-us/azure/durable-task/durable-functions/durable-functions-diagnostics)
- [DTS overview and limits](https://learn.microsoft.com/en-us/azure/durable-task/scheduler/durable-task-scheduler)
- [DTS managed identity](https://learn.microsoft.com/en-us/azure/durable-task/scheduler/durable-task-scheduler-identity)
- [Durable entities](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-entities)
- [Programming model](https://learn.microsoft.com/en-us/azure/durable-task/common/programming-model-overview)
- [Unit testing](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-unit-testing)
- [Saga pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/saga)
- [Retry pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/retry)
- [PostgreSQL transient errors](https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/concepts-connectivity)

## Prerequisites and setup

Use Node.js 22 or 24, Azure Functions Core Tools v4, and Docker. A .NET SDK is optional: stable extension bundle 4.38.1 includes a Durable extension new enough for critical sections. Run `npm run doctor` first, then follow the README.

The DTS emulator keeps orchestration state in memory. Restarting it clears orchestration history.

## Rules and logistics

- AI coding tools are allowed. If you use them, including the complete chat log is optional but desirable.
- Submit the actual private code repository with its complete Git history and a video walkthrough.
- Please don't publish your solution publicly.
