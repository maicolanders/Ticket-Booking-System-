# RUNBOOK — Stuck or failed checkout

**Sources of truth:** PostgreSQL (`Checkout`, `Hold`, `ShowSeat`, `Booking`) for state, the DTS dashboard (http://localhost:8082, task hub `default`) for the workflow, and the payment provider ledger for money. Every record carries `checkoutId` (= orchestration instance id) and `correlationId`.

```bash
psql "postgresql://ticket:ticket@localhost:5433/ticketing"     # or: docker exec -it ticketing-db psql -U ticket -d ticketing
```

## 1. Locate the checkout

```sql
-- One checkout, with its hold and booking
SELECT c.id, c."correlationId", c.status, c."failureReason", c."holdExpiresAt", c."amountDue",
       c."chargeId", c."bookingReference", c."cancelRequestedAt", c."updatedAt", h.status AS hold_status
FROM "Checkout" c LEFT JOIN "Hold" h ON h.id = c."holdId"
WHERE c.id = '<checkoutId>';

-- Stuck: non-terminal and idle for over 5 minutes
SELECT id, status, "holdExpiresAt", "updatedAt" FROM "Checkout"
WHERE status IN ('PENDING','AWAITING_PAYMENT','PROCESSING_PAYMENT') AND "updatedAt" < now() - interval '5 minutes'
ORDER BY "updatedAt";

-- Failed: needs an operator
SELECT id, "failureReason", "chargeId", "updatedAt" FROM "Checkout" WHERE status = 'FAILED' ORDER BY "updatedAt" DESC;
```

## 2. Trace it end to end

```bash
# Every log line for the checkout. The host prefixes worker output with a timestamp, so extract the JSON first
# (start the host with: npm run start:functions 2>&1 | tee functions.log)
grep -o '{"time".*}' functions.log | jq -c 'select(.correlationId == "<correlationId>") | {time, level, event, activity, status, outcome, err: .err.message}'

# Every provider call for it, and the money
curl -s localhost:4100/__admin/requests | jq '[.[] | select(.correlationId == "<correlationId>")]'
curl -s localhost:4100/__admin/ledger | jq '{charges: [.charges[] | select(.metadata.checkoutId == "<checkoutId>")], refunds}'
curl -s "localhost:4100/v1/charges?idempotencyKey=<checkoutId>:charge"
```

In the DTS dashboard, open instance `<checkoutId>`: the custom status `step` shows where it is (`awaiting payment`, `charging`, `booking`, `refunding`, `sending ticket`), and the history shows the failing activity and its retries.

## 3. Decide

| Symptom | Meaning | Action |
|---|---|---|
| AWAITING_PAYMENT long after `holdExpiresAt`, no instance in DTS | Orchestration lost (e.g. emulator restart) | Nothing: `recoverAbandonedCheckouts` expires it within `CHECKOUT_RECOVERY_GRACE_SECONDS` (+1 min). Check for `checkout.recovered.expired` in the logs. |
| PENDING, no instance | Orchestration lost before the hold | No seats or money involved; mark it FAILED (SQL below). |
| PROCESSING_PAYMENT, instance running, `step` = `charging` | Provider retries in progress (up to ~30 s) | Wait. |
| PROCESSING_PAYMENT, no instance or instance Failed | Money may have moved | Check the ledger by `<checkoutId>:charge`. Charged with no booking → refund (below), then release. Not charged → release. |
| FAILED, `failureReason` "payment outcome unknown" | Charge unresolved after retries; seats kept held | Check the ledger. Charged → refund, then release. Absent → release. |
| FAILED, "refund … failed; refund manually" | Customer was charged, booking not made | Refund (below), then release. |
| FAILED, "booking outcome unknown" | Charge succeeded; booking may exist | If `Booking.paymentKey = '<checkoutId>:charge'` exists, the customer has a ticket: leave it. Otherwise refund, then release. |
| CONFIRMED, customer has no email | Ticket redelivery exhausted (`checkout.ticket.undelivered`) | The booking is valid. Once mail works, the customer can see the QR in *My Bookings* (`GET /api/bookings/<reference>` returns `qrDataUrl`); send it to them from there. |

## 4. Remediate

```bash
# Refund with the saga's own key, so it can never double-refund the saga
curl -s -X POST localhost:4100/v1/refunds -H 'content-type: application/json' \
  -H 'Idempotency-Key: <checkoutId>:refund' -H 'X-Correlation-Id: <correlationId>' -d '{"chargeId":"<chargeId>"}'
```

```sql
-- Release the seats of a checkout that holds no booking, and close it as FAILED (one transaction)
BEGIN;
UPDATE "ShowSeat" SET status = 'AVAILABLE', "holdId" = NULL
 WHERE "holdId" = (SELECT "holdId" FROM "Checkout" WHERE id = '<checkoutId>') AND status = 'HELD';
UPDATE "Hold" SET status = 'RELEASED' WHERE id = (SELECT "holdId" FROM "Checkout" WHERE id = '<checkoutId>');
UPDATE "Checkout" SET status = 'FAILED', "failureReason" = 'resolved by operator: <what was done>', "updatedAt" = now()
 WHERE id = '<checkoutId>' AND "bookingId" IS NULL;
COMMIT;
```

Stop a still-running instance first (DTS dashboard → instance → Terminate) so it does not act on stale state. Record what was done in `failureReason`.
