import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createPaymentSimulator } from '../src/app.js';

const charge = { amount: 1250, currency: 'USD', paymentToken: 'tok_ok', metadata: { checkoutId: 'co_1' } };

describe('payment simulator', () => {
  it('replays an identical charge and rejects key reuse with another body', async () => {
    const app = createPaymentSimulator();
    const first = await request(app).post('/v1/charges').set('Idempotency-Key', 'key-1').send(charge);
    const replay = await request(app).post('/v1/charges').set('Idempotency-Key', 'key-1').send(charge);
    const conflict = await request(app)
      .post('/v1/charges')
      .set('Idempotency-Key', 'key-1')
      .send({ ...charge, amount: 999 });
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(conflict.status).toBe(409);
  });

  it('implements decline and flaky tokens', async () => {
    const app = createPaymentSimulator();
    const decline = await request(app)
      .post('/v1/charges')
      .set('Idempotency-Key', 'decline')
      .send({ ...charge, paymentToken: 'tok_decline' });
    expect(decline.status).toBe(402);
    for (const expected of [503, 503, 201]) {
      const response = await request(app)
        .post('/v1/charges')
        .set('Idempotency-Key', 'flaky')
        .send({ ...charge, paymentToken: 'tok_flaky' });
      expect(response.status).toBe(expected);
    }
  });

  it('delays slow charges', async () => {
    const app = createPaymentSimulator({ slowMs: 25 });
    const started = Date.now();
    const response = await request(app)
      .post('/v1/charges')
      .set('Idempotency-Key', 'slow')
      .send({ ...charge, paymentToken: 'tok_slow' });
    expect(response.status).toBe(201);
    expect(Date.now() - started).toBeGreaterThanOrEqual(20);
  });

  it('records a timeout charge before destroying the response', async () => {
    const app = createPaymentSimulator({ hangMs: 10 });
    await expect(
      request(app)
        .post('/v1/charges')
        .set('Idempotency-Key', 'timeout')
        .send({ ...charge, paymentToken: 'tok_timeout' }),
    ).rejects.toBeDefined();
    const lookup = await request(app).get('/v1/charges').query({ idempotencyKey: 'timeout' });
    expect(lookup.status).toBe(200);
    expect(lookup.body.status).toBe('succeeded');
  });

  it('enforces full-refund rules and refund replay', async () => {
    const app = createPaymentSimulator();
    const unknown = await request(app)
      .post('/v1/refunds')
      .set('Idempotency-Key', 'unknown-refund')
      .send({ chargeId: 'ch_missing' });
    expect(unknown.status).toBe(404);
    const created = await request(app).post('/v1/charges').set('Idempotency-Key', 'charge').send(charge);
    const body = { chargeId: created.body.id };
    const refund = await request(app).post('/v1/refunds').set('Idempotency-Key', 'refund').send(body);
    const replay = await request(app).post('/v1/refunds').set('Idempotency-Key', 'refund').send(body);
    const duplicate = await request(app).post('/v1/refunds').set('Idempotency-Key', 'other').send(body);
    expect(refund.status).toBe(201);
    expect(replay.body).toEqual(refund.body);
    expect(duplicate.status).toBe(409);
  });

  it('exposes and resets the ledger and request log', async () => {
    const app = createPaymentSimulator();
    await request(app)
      .post('/v1/charges')
      .set('Idempotency-Key', 'observed')
      .set('X-Correlation-Id', 'corr-1')
      .set('traceparent', '00-a-b-01')
      .send(charge);
    const ledger = await request(app).get('/__admin/ledger');
    const log = await request(app).get('/__admin/requests');
    expect(ledger.body.charges).toHaveLength(1);
    expect(ledger.body.charges[0].correlationId).toBe('corr-1');
    expect(log.body.some((entry: { idempotencyKey: string }) => entry.idempotencyKey === 'observed')).toBe(true);
    expect((await request(app).post('/__admin/reset')).status).toBe(204);
    expect((await request(app).get('/__admin/ledger')).body.charges).toHaveLength(0);
  });

  it('applies and clears seeded global faults', async () => {
    const app = createPaymentSimulator({ seed: 42 });
    expect((await request(app).post('/__admin/faults').send({ errorRate: 1 })).status).toBe(200);
    expect(await request(app).post('/v1/charges').set('Idempotency-Key', 'fault').send(charge)).toMatchObject({ status: 503 });
    expect((await request(app).delete('/__admin/faults')).status).toBe(204);
    expect(await request(app).post('/v1/charges').set('Idempotency-Key', 'fault').send(charge)).toMatchObject({ status: 201 });
  });
});
