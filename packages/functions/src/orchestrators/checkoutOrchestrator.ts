import type { OrchestrationContext, RetryOptions, Task } from 'durable-functions';
import { CheckoutStatus } from '@ticket/shared';
import type { LogFields } from '@ticket/domain';
import { logger } from '../logger';
import {
  Activities,
  Events,
  RetryPolicies,
  type BeginPaymentResult,
  type ChargeResult,
  type CheckoutRef,
  type CheckoutState,
  type ConfirmResult,
  type PaymentSubmitted,
  type RefundResult,
  type ReleaseStatus,
} from '../contracts';

/** After the first delivery attempts fail, keep trying for a while: the booking already stands. */
const TICKET_REDELIVERY_ROUNDS = 3;
const TICKET_REDELIVERY_DELAY_MS = 5 * 60_000;

/**
 * The checkout saga. Instance id = checkoutId. Deterministic by construction: all
 * I/O happens in activities, time comes from context.df.currentUtcDateTime, and
 * logs are written only when not replaying.
 *
 *   hold seats ─▶ wait for the first of { hold timer, PaymentSubmitted, CancelRequested }
 *     timer  ─▶ release EXPIRED
 *     cancel ─▶ release CANCELLED
 *     pay    ─▶ begin (hold → CAPTURING) ─▶ charge
 *                 declined ─▶ release PAYMENT_DECLINED
 *                 charged  ─▶ book ─▶ ticket ─▶ CONFIRMED
 *                              └ not booked ─▶ refund ─▶ release CANCELLED | REFUNDED
 *
 * Anything whose money outcome cannot be settled ends FAILED for an operator.
 */
export function* checkoutOrchestrator(context: OrchestrationContext): Generator<Task, CheckoutStatus, unknown> {
  const ref = context.df.getInput() as CheckoutRef;
  const log = (event: string, fields: LogFields = {}) => {
    if (!context.df.isReplaying) logger.info(event, { ...ref, instanceId: context.df.instanceId, ...fields });
  };
  const report = (status: CheckoutStatus, step: string) => context.df.setCustomStatus({ status, step, ...ref });

  function* call<T>(name: string, retry: RetryOptions, input: object = {}): Generator<Task, T, unknown> {
    return (yield context.df.callActivityWithRetry(name, retry, { ...ref, ...input })) as T;
  }

  function* end(status: CheckoutStatus): Generator<Task, CheckoutStatus, unknown> {
    report(status, 'done');
    log('checkout.orchestration.completed', { status });
    return status;
  }

  function* release(status: ReleaseStatus, reason?: string): Generator<Task, CheckoutStatus, unknown> {
    const final = yield* call<CheckoutStatus>(Activities.release, RetryPolicies.database, { status, reason });
    return yield* end(final);
  }

  function* fail(reason: string, releaseSeats: boolean): Generator<Task, CheckoutStatus, unknown> {
    const final = yield* call<CheckoutStatus>(Activities.fail, RetryPolicies.database, { reason, releaseSeats });
    return yield* end(final);
  }

  log('checkout.orchestration.started');
  report(CheckoutStatus.PENDING, 'holding seats');
  const held = yield* call<CheckoutState>(Activities.holdSeats, RetryPolicies.database);
  if (held.status !== CheckoutStatus.AWAITING_PAYMENT || !held.holdExpiresAt) return yield* end(held.status);

  // Wait for whichever comes first. Events raised early (even before the hold) are buffered.
  report(CheckoutStatus.AWAITING_PAYMENT, 'awaiting payment');
  const holdTimer = context.df.createTimer(new Date(held.holdExpiresAt));
  const payment = context.df.waitForExternalEvent(Events.paymentSubmitted);
  const cancel = context.df.waitForExternalEvent(Events.cancelRequested);
  const first = yield context.df.Task.any([holdTimer, payment, cancel]);
  if (first !== holdTimer) holdTimer.cancel();
  if (first === holdTimer) return yield* release(CheckoutStatus.EXPIRED);
  if (first === cancel) return yield* release(CheckoutStatus.CANCELLED);

  const { paymentToken } = payment.result as PaymentSubmitted;
  report(CheckoutStatus.PROCESSING_PAYMENT, 'beginning payment');
  const begun = yield* call<BeginPaymentResult>(Activities.beginPayment, RetryPolicies.database);
  if (begun === 'expired') return yield* end(CheckoutStatus.EXPIRED);
  if (begun === 'not_payable') return yield* fail('checkout was not payable when payment began', false);

  report(CheckoutStatus.PROCESSING_PAYMENT, 'charging');
  let charge: ChargeResult;
  try {
    charge = yield* call<ChargeResult>(Activities.charge, RetryPolicies.payment, { paymentToken });
  } catch {
    // Retries exhausted on transient failures: the charge may or may not exist. Keep the seats.
    return yield* fail('payment outcome unknown after retries; reconcile with the provider by idempotency key', false);
  }
  if (charge.kind === 'declined') return yield* release(CheckoutStatus.PAYMENT_DECLINED, charge.reason);
  if (charge.kind === 'rejected') return yield* fail(`payment rejected by provider: ${charge.code}`, true);

  report(CheckoutStatus.PROCESSING_PAYMENT, 'booking');
  const booked = yield* call<ConfirmResult>(Activities.confirmBooking, RetryPolicies.database, {
    chargeId: charge.chargeId,
  });
  if (booked.outcome !== 'booked') {
    // Compensation: this checkout's own charge (unique key) is refunded before the seats go back.
    report(CheckoutStatus.PROCESSING_PAYMENT, 'refunding');
    let refund: RefundResult;
    try {
      refund = yield* call<RefundResult>(Activities.refund, RetryPolicies.payment, { chargeId: charge.chargeId });
    } catch {
      refund = { kind: 'rejected', code: 'retries_exhausted' };
    }
    if (refund.kind === 'rejected') {
      return yield* fail(`refund of charge ${charge.chargeId} failed (${refund.code}); refund manually`, false);
    }
    return booked.outcome === 'cancel_requested'
      ? yield* release(CheckoutStatus.CANCELLED, 'cancelled by customer during payment; charge refunded')
      : yield* release(CheckoutStatus.REFUNDED, 'seats could not be booked after payment; charge refunded');
  }

  // Booked. Publish CONFIRMED once the ticket is out; if mail is down, confirm anyway
  // and keep redelivering on durable timers — the booking already stands.
  report(CheckoutStatus.PROCESSING_PAYMENT, 'sending ticket');
  let delivered = yield* tryDeliverTicket();
  yield* call<CheckoutStatus>(Activities.complete, RetryPolicies.database);
  for (let round = 1; !delivered && round <= TICKET_REDELIVERY_ROUNDS; round += 1) {
    report(CheckoutStatus.CONFIRMED, `ticket redelivery ${round}/${TICKET_REDELIVERY_ROUNDS}`);
    yield context.df.createTimer(new Date(context.df.currentUtcDateTime.getTime() + TICKET_REDELIVERY_DELAY_MS));
    delivered = yield* tryDeliverTicket();
  }
  if (!delivered) {
    if (!context.df.isReplaying) logger.error('checkout.ticket.undelivered', { ...ref, bookingReference: booked.bookingReference });
  }
  return yield* end(CheckoutStatus.CONFIRMED);

  function* tryDeliverTicket(): Generator<Task, boolean, unknown> {
    try {
      yield* call(Activities.sendTicket, RetryPolicies.email);
      return true;
    } catch {
      return false;
    }
  }
}
