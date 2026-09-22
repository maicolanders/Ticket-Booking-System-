import { env } from '../config/env';

export interface ChargeInput {
  amount: number;
  currency: string;
  paymentToken: string;
  metadata?: Record<string, string>;
}

export interface ChargeResult {
  id: string;
  status: 'succeeded';
  amount: number;
  currency: string;
}

async function paymentRequest<T>(path: string, idempotencyKey: string, body: unknown): Promise<T> {
  const response = await fetch(`${env.PAYMENT_API_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(env.PAYMENT_TIMEOUT_MS),
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const code =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      payload.error &&
      typeof payload.error === 'object' &&
      'code' in payload.error &&
      typeof payload.error.code === 'string'
        ? payload.error.code
        : undefined;
    throw new Error(code ?? `Payment provider returned ${response.status}`);
  }
  return payload as T;
}

export function chargePayment(input: ChargeInput, idempotencyKey: string): Promise<ChargeResult> {
  return paymentRequest<ChargeResult>('/v1/charges', idempotencyKey, input);
}

export function refundPayment(chargeId: string, idempotencyKey: string): Promise<void> {
  return paymentRequest('/v1/refunds', idempotencyKey, { chargeId }).then(() => undefined);
}
