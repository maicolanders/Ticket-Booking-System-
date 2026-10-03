import * as df from 'durable-functions';
import type { InvocationContext } from '@azure/functions';
import { CheckoutStatus } from '@ticket/shared';
import {
  PaymentRejectedError,
  beginCheckoutPayment,
  completeCheckout,
  confirmCheckoutBooking,
  deliverTicket,
  failCheckout,
  getCheckout,
  holdCheckoutSeats,
  releaseCheckout,
  type Checkout,
  type Logger,
} from '@ticket/domain';
import { config } from '../config';
import { logger, mailer, paymentGateway } from '../services';
import {
  Activities,
  type BeginPaymentResult,
  type ChargeResult,
  type CheckoutRef,
  type CheckoutState,
  type ConfirmResult,
  type RefundResult,
  type ReleaseStatus,
} from '../contracts';

// Activities are thin adapters over @ticket/domain. Each domain operation is
// idempotent, so a retried or replayed activity never repeats an effect.

function activity<I extends CheckoutRef, O>(name: string, handler: (input: I, log: Logger) => Promise<O>): void {
  df.app.activity(name, {
    handler: async (input: I, context: InvocationContext): Promise<O> => {
      const log = logger.child({
        checkoutId: input.checkoutId,
        correlationId: input.correlationId,
        activity: name,
        invocationId: context.invocationId,
      });
      try {
        return await handler(input, log);
      } catch (err) {
        log.warn('activity.attempt_failed', { err });
        throw err;
      }
    },
  });
}

async function loadCheckout(checkoutId: string): Promise<Checkout> {
  const checkout = await getCheckout(checkoutId);
  if (!checkout) throw new Error(`Checkout ${checkoutId} not found`);
  return checkout;
}

const chargeKey = (checkoutId: string) => `${checkoutId}:charge`;
const refundKey = (checkoutId: string) => `${checkoutId}:refund`;

activity<CheckoutRef, CheckoutState>(Activities.holdSeats, async ({ checkoutId }, log) => {
  const checkout = await holdCheckoutSeats(checkoutId, config.HOLD_TTL_SECONDS);
  log.info(checkout.status === CheckoutStatus.AWAITING_PAYMENT ? 'checkout.seats.held' : 'checkout.seats.rejected', {
    status: checkout.status,
    holdExpiresAt: checkout.holdExpiresAt,
    amountDue: checkout.amountDue,
    failureReason: checkout.failureReason,
  });
  return { status: checkout.status, holdExpiresAt: checkout.holdExpiresAt?.toISOString() ?? null };
});

activity<CheckoutRef, BeginPaymentResult>(Activities.beginPayment, async ({ checkoutId }, log) => {
  const { outcome, checkout } = await beginCheckoutPayment(checkoutId);
  log.info('checkout.payment.begun', { outcome, status: checkout.status });
  return outcome;
});

activity<CheckoutRef & { paymentToken: string }, ChargeResult>(
  Activities.charge,
  async ({ checkoutId, correlationId, paymentToken }, log) => {
    const checkout = await loadCheckout(checkoutId);
    if (checkout.amountDue === null) throw new Error(`Checkout ${checkoutId} has no amount due`);
    try {
      const outcome = await paymentGateway.charge({
        idempotencyKey: chargeKey(checkoutId),
        correlationId,
        amountMinor: checkout.amountDue,
        currency: checkout.currency,
        paymentToken,
        metadata: { checkoutId },
      });
      if (outcome.kind === 'charged') {
        log.info('checkout.payment.charged', { chargeId: outcome.chargeId, amount: outcome.amountMinor });
        return { kind: 'charged', chargeId: outcome.chargeId };
      }
      log.info('checkout.payment.declined', { reason: outcome.reason });
      return outcome;
    } catch (err) {
      if (!(err instanceof PaymentRejectedError)) throw err;
      log.error('checkout.payment.rejected', { code: err.code });
      return { kind: 'rejected', code: err.code };
    }
  },
);

activity<CheckoutRef & { chargeId: string }, ConfirmResult>(
  Activities.confirmBooking,
  async ({ checkoutId, chargeId }, log) => {
    const { outcome, checkout } = await confirmCheckoutBooking(checkoutId, chargeId);
    log.info('checkout.booking.confirmed', { outcome, bookingReference: checkout.bookingReference });
    return outcome === 'booked' ? { outcome, bookingReference: checkout.bookingReference! } : { outcome, chargeId };
  },
);

activity<CheckoutRef & { chargeId: string }, RefundResult>(
  Activities.refund,
  async ({ checkoutId, correlationId, chargeId }, log) => {
    try {
      await paymentGateway.refund({ idempotencyKey: refundKey(checkoutId), correlationId, chargeId });
      log.info('checkout.compensation.refunded', { chargeId });
      return { kind: 'refunded' };
    } catch (err) {
      if (!(err instanceof PaymentRejectedError)) throw err;
      log.error('checkout.compensation.refund_rejected', { chargeId, code: err.code });
      return { kind: 'rejected', code: err.code };
    }
  },
);

activity<CheckoutRef, 'sent' | 'already_sent'>(Activities.sendTicket, async ({ checkoutId }, log) => {
  const checkout = await loadCheckout(checkoutId);
  if (!checkout.bookingId) throw new Error(`Checkout ${checkoutId} has no booking`);
  const result = await deliverTicket(checkout.bookingId, mailer);
  log.info('checkout.ticket.delivered', { result, bookingReference: checkout.bookingReference });
  return result;
});

activity<CheckoutRef, CheckoutStatus>(Activities.complete, async ({ checkoutId }, log) => {
  const checkout = await completeCheckout(checkoutId);
  log.info('checkout.completed', { status: checkout.status });
  return checkout.status;
});

activity<CheckoutRef & { status: ReleaseStatus; reason?: string }, CheckoutStatus>(
  Activities.release,
  async ({ checkoutId, status, reason }, log) => {
    const checkout = await releaseCheckout(checkoutId, status, reason);
    log.info('checkout.released', { status: checkout.status, reason });
    return checkout.status;
  },
);

activity<CheckoutRef & { reason: string; releaseSeats: boolean }, CheckoutStatus>(
  Activities.fail,
  async ({ checkoutId, reason, releaseSeats }, log) => {
    const checkout = await failCheckout(checkoutId, reason, { releaseSeats });
    log.error('checkout.failed', { status: checkout.status, reason, releaseSeats });
    return checkout.status;
  },
);
