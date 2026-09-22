# Payment simulator

The simulator is a deterministic, in-memory HTTP service for local development and assessment tests. Its state is lost whenever the process restarts. Amounts are integer minor units and currencies are three-letter uppercase ISO codes.

## API

Every write requires `Idempotency-Key`. Repeating a completed charge or refund with an identical body returns the original status and body. Transient 503 responses are not persisted, allowing the same key to be retried. Reusing a key with a different body or operation returns `409 idempotency_key_reuse`.

- `POST /v1/charges` accepts `{ amount, currency, paymentToken, metadata? }`. It returns `201` with a succeeded charge, `402 card_declined`, `400` for invalid input, or `503` for a transient failure.
- `GET /v1/charges/:id` looks up a charge.
- `GET /v1/charges?idempotencyKey=...` resolves an outcome by key.
- `POST /v1/refunds` accepts `{ chargeId }` and makes a full refund. An unknown charge returns 404. A second key for an already-refunded charge returns `409 charge_already_refunded`.
- `GET /health` reports readiness.

`X-Correlation-Id` is echoed on responses and recorded with `traceparent` in the ledger and request log.

## Test tokens

| Token | Behaviour |
|---|---|
| `tok_ok` | Succeeds. |
| `tok_decline` | Returns `402 card_declined`. |
| `tok_flaky` | Returns 503 twice per key, then succeeds. |
| `tok_slow` | Succeeds after `SIM_SLOW_MS` (default 5000). |
| `tok_timeout` | Records success, waits `SIM_HANG_MS` (default 60000), then closes the socket without a response. |

## Test administration

- `GET /__admin/ledger` returns charges and refunds, including keys, metadata, and correlation headers.
- `GET /__admin/requests` returns every request with timestamp, route, key, token, correlation headers, and response status.
- `POST /__admin/reset` clears all in-memory state.
- `POST /__admin/faults` accepts `{ latencyMs?, errorRate?, hang? }`. Latency and seeded errors occur before processing; hang withholds a processed response.
- `DELETE /__admin/faults` clears overrides.

Set `SIM_SEED` to reproduce global error-rate decisions. Run `npm run test:sim` from the repository root.
