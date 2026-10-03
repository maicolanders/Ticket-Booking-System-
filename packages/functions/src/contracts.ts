import * as df from 'durable-functions';
import type { CheckoutStatus } from '@ticket/shared';

// Names and payloads shared by the HTTP starters, the orchestrator and the activities.

export const CHECKOUT_ORCHESTRATOR = 'checkoutOrchestrator';

export const Events = {
  paymentSubmitted: 'PaymentSubmitted',
  cancelRequested: 'CancelRequested',
} as const;

export const Activities = {
  holdSeats: 'holdCheckoutSeats',
  beginPayment: 'beginCheckoutPayment',
  charge: 'chargeCheckout',
  confirmBooking: 'confirmCheckoutBooking',
  refund: 'refundCheckout',
  sendTicket: 'sendCheckoutTicket',
  complete: 'completeCheckout',
  release: 'releaseCheckout',
  fail: 'failCheckout',
} as const;

/** Orchestration input; every activity receives it, so every log line can carry both ids. */
export interface CheckoutRef {
  checkoutId: string;
  correlationId: string;
}

export interface PaymentSubmitted {
  paymentToken: string;
}

export interface CheckoutState {
  status: CheckoutStatus;
  holdExpiresAt: string | null;
}

export type BeginPaymentResult = 'processing' | 'expired' | 'not_payable';

/** A charge either happened, was declined, or was refused outright; transient failures throw (and are retried). */
export type ChargeResult =
  | { kind: 'charged'; chargeId: string }
  | { kind: 'declined'; reason: string }
  | { kind: 'rejected'; code: string };

export type ConfirmResult =
  | { outcome: 'booked'; bookingReference: string }
  | { outcome: 'cancel_requested' | 'not_confirmable'; chargeId: string };

export type RefundResult = { kind: 'refunded' } | { kind: 'rejected'; code: string };

export type ReleaseStatus = 'EXPIRED' | 'CANCELLED' | 'PAYMENT_DECLINED' | 'REFUNDED';

function retry(firstRetryMs: number, maxAttempts: number, maxRetryMs: number): df.RetryOptions {
  const options = new df.RetryOptions(firstRetryMs, maxAttempts);
  options.backoffCoefficient = 2;
  options.maxRetryIntervalInMilliseconds = maxRetryMs;
  return options;
}

/**
 * The only retry layer above a single call. Activities throw only for failures
 * worth repeating (business outcomes are returned), so retrying everything that
 * throws is correct. Within an attempt the domain's transaction runner may also
 * retry deadlocks or lock timeouts, at most 3 times.
 */
export const RetryPolicies = {
  /** Database work: lock timeouts, connection blips. 4 attempts: 1s, 2s, 4s. */
  database: retry(1_000, 4, 10_000),
  /** Payment provider: 503s, timeouts. 5 attempts: 2s, 4s, 8s, 15s. Same idempotency key every time. */
  payment: retry(2_000, 5, 15_000),
  /** Ticket email: SMTP or provider outages. 4 attempts: 5s, 10s, 20s. */
  email: retry(5_000, 4, 30_000),
} as const;
