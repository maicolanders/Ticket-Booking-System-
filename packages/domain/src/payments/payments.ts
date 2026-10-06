/*
 * Payment port. Hosts depend on this interface, never on a provider's HTTP API.
 *
 * Every call makes exactly one attempt and reports its outcome in one of three
 * ways, so the caller (a Durable activity retry policy) decides what to retry:
 *   - a returned outcome: the definitive business answer (charged, declined, refunded);
 *   - TransientPaymentError: safe and useful to repeat with the SAME idempotency key;
 *   - PaymentRejectedError: repeating cannot succeed (invalid request, key reuse, unknown charge).
 */

export interface ChargeRequest {
  idempotencyKey: string;
  correlationId: string;
  amountMinor: number;
  currency: string;
  paymentToken: string;
  metadata: Record<string, string>;
}

export interface RefundRequest {
  idempotencyKey: string;
  correlationId: string;
  chargeId: string;
}

export type ChargeOutcome =
  | { kind: 'charged'; chargeId: string; amountMinor: number }
  | { kind: 'declined'; reason: string };

export interface PaymentGateway {
  charge(request: ChargeRequest): Promise<ChargeOutcome>;
  /** Resolves once the charge is refunded, including when it already was. */
  refund(request: RefundRequest): Promise<void>;
}

export class TransientPaymentError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TransientPaymentError';
  }
}

export class PaymentRejectedError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentRejectedError';
  }
}
