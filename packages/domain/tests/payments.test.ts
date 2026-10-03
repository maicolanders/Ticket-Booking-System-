import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PaymentRejectedError, TransientPaymentError } from '../src/payments/payments';
import { SimulatorPaymentGateway } from '../src/payments/simulatorGateway';

// Runs against the docker-compose payment simulator; every test uses fresh keys.
const baseUrl = process.env.PAYMENT_API_URL ?? 'http://localhost:4100';
const gateway = new SimulatorPaymentGateway({ baseUrl, timeoutMs: 2_000 });

const chargeRequest = (paymentToken: string) => {
  const id = randomUUID();
  return {
    idempotencyKey: `test:${id}:charge`,
    correlationId: `corr-${id}`,
    amountMinor: 1250,
    currency: 'USD',
    paymentToken,
    metadata: { checkoutId: id },
  };
};

const simulatorRequests = async (idempotencyKey: string) => {
  const all = (await (await fetch(`${baseUrl}/__admin/requests`)).json()) as Array<{
    idempotencyKey: string | null;
    correlationId: string | null;
  }>;
  return all.filter((entry) => entry.idempotencyKey === idempotencyKey);
};

describe('SimulatorPaymentGateway.charge', () => {
  it('charges once per idempotency key and sends the correlation id on every call', async () => {
    const request = chargeRequest('tok_ok');

    const first = await gateway.charge(request);
    const repeat = await gateway.charge(request);

    expect(first).toMatchObject({ kind: 'charged', amountMinor: 1250 });
    expect(repeat).toEqual(first);
    const calls = await simulatorRequests(request.idempotencyKey);
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.correlationId === request.correlationId)).toBe(true);
  });

  it('reports a decline as an outcome, not an error', async () => {
    const request = chargeRequest('tok_decline');

    await expect(gateway.charge(request)).resolves.toEqual({ kind: 'declined', reason: 'card_declined' });
    expect(await simulatorRequests(request.idempotencyKey)).toHaveLength(1);
  });

  it('signals transient failures so the caller can retry with the same key', async () => {
    const request = chargeRequest('tok_flaky');

    await expect(gateway.charge(request)).rejects.toBeInstanceOf(TransientPaymentError);
    await expect(gateway.charge(request)).rejects.toBeInstanceOf(TransientPaymentError);
    await expect(gateway.charge(request)).resolves.toMatchObject({ kind: 'charged' });
  });

  it('resolves a timed-out charge by looking it up instead of guessing', async () => {
    const request = chargeRequest('tok_timeout');
    const impatient = new SimulatorPaymentGateway({ baseUrl, timeoutMs: 300 });

    await expect(impatient.charge(request)).resolves.toMatchObject({ kind: 'charged', amountMinor: 1250 });
  });

  it('rejects reusing a key for a different charge', async () => {
    const request = chargeRequest('tok_ok');
    await gateway.charge(request);

    await expect(gateway.charge({ ...request, amountMinor: 999 })).rejects.toMatchObject({
      name: 'PaymentRejectedError',
      code: 'idempotency_key_reuse',
    });
  });
});

describe('SimulatorPaymentGateway.refund', () => {
  it('refunds once and treats an already-refunded charge as done', async () => {
    const request = chargeRequest('tok_ok');
    const charge = await gateway.charge(request);
    if (charge.kind !== 'charged') throw new Error('expected a charge');
    const refund = (key: string) =>
      gateway.refund({ idempotencyKey: key, correlationId: request.correlationId, chargeId: charge.chargeId });

    await refund(`${request.idempotencyKey}:refund`);
    await refund(`${request.idempotencyKey}:refund`);
    await refund(`${request.idempotencyKey}:refund-other-key`);

    const ledger = (await (await fetch(`${baseUrl}/__admin/ledger`)).json()) as {
      refunds: Array<{ chargeId: string }>;
    };
    expect(ledger.refunds.filter((r) => r.chargeId === charge.chargeId)).toHaveLength(1);
  });

  it('rejects refunding an unknown charge', async () => {
    await expect(
      gateway.refund({ idempotencyKey: randomUUID(), correlationId: 'c', chargeId: 'ch_missing' }),
    ).rejects.toBeInstanceOf(PaymentRejectedError);
  });
});
