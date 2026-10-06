import { describe, expect, it } from 'vitest';
import { Activities } from '../src/contracts';
import { exhausted, ref, runOrchestrator, type Script } from './fakeOrchestrationContext';

const A = Activities;

/** A script where everything succeeds; tests override single steps. */
function happy(overrides: Partial<Script['activities']> = {}, rest: Omit<Script, 'activities'> = {}): Script {
  return {
    ...rest,
    activities: {
      [A.holdSeats]: () => ({ status: 'AWAITING_PAYMENT', holdExpiresAt: '2030-01-01T00:10:00Z' }),
      [A.beginPayment]: () => 'processing',
      [A.charge]: () => ({ kind: 'charged', chargeId: 'ch_1' }),
      [A.confirmBooking]: () => ({ outcome: 'booked', bookingReference: 'BK-TEST01' }),
      [A.sendTicket]: () => 'sent',
      [A.complete]: () => 'CONFIRMED',
      [A.release]: (input) => input.status,
      [A.fail]: () => 'FAILED',
      [A.refund]: () => ({ kind: 'refunded' }),
      ...overrides,
    },
  };
}

describe('checkout orchestrator: happy path', () => {
  it('holds, charges, books, sends the ticket, then confirms', () => {
    const run = runOrchestrator(happy({}, { paymentToken: 'tok_card' }));

    expect(run.status).toBe('CONFIRMED');
    expect(run.names).toEqual([A.holdSeats, A.beginPayment, A.charge, A.confirmBooking, A.sendTicket, A.complete]);
    expect(run.calls.find((c) => c.name === A.charge)?.input.paymentToken).toBe('tok_card');
    expect(run.calls.find((c) => c.name === A.confirmBooking)?.input.chargeId).toBe('ch_1');
    expect(run.timers[0].cancelled).toBe(true);
  });

  it('passes the checkout and correlation ids to every activity', () => {
    const run = runOrchestrator(happy());

    expect(run.calls.every((c) => c.input.checkoutId === ref.checkoutId)).toBe(true);
    expect(run.calls.every((c) => c.input.correlationId === ref.correlationId)).toBe(true);
    expect(run.statuses.at(-1)).toMatchObject({ status: 'CONFIRMED', correlationId: ref.correlationId });
  });
});

describe('checkout orchestrator: before payment', () => {
  it('ends REJECTED without waiting when the seats cannot be held', () => {
    const run = runOrchestrator(happy({ [A.holdSeats]: () => ({ status: 'REJECTED', holdExpiresAt: null }) }));

    expect(run.status).toBe('REJECTED');
    expect(run.names).toEqual([A.holdSeats]);
    expect(run.timers).toHaveLength(0);
  });

  it('releases the seats as EXPIRED when the hold timer fires first', () => {
    const run = runOrchestrator(happy({}, { first: 'timer' }));

    expect(run.status).toBe('EXPIRED');
    expect(run.names).toEqual([A.holdSeats, A.release]);
    expect(run.calls[1].input.status).toBe('EXPIRED');
  });

  it('releases the seats as CANCELLED when the customer cancels first, and cancels the timer', () => {
    const run = runOrchestrator(happy({}, { first: 'cancel' }));

    expect(run.status).toBe('CANCELLED');
    expect(run.names).toEqual([A.holdSeats, A.release]);
    expect(run.timers[0].cancelled).toBe(true);
  });

  it('does not charge when the hold lapsed by the database clock as payment began', () => {
    const run = runOrchestrator(happy({ [A.beginPayment]: () => 'expired' }));

    expect(run.status).toBe('EXPIRED');
    expect(run.names).not.toContain(A.charge);
  });
});

describe('checkout orchestrator: payment outcomes', () => {
  it('releases PAYMENT_DECLINED after a single charge call', () => {
    const run = runOrchestrator(happy({ [A.charge]: () => ({ kind: 'declined', reason: 'card_declined' }) }));

    expect(run.status).toBe('PAYMENT_DECLINED');
    expect(run.names.filter((n) => n === A.charge)).toHaveLength(1);
    expect(run.calls.at(-1)).toMatchObject({ name: A.release, input: { status: 'PAYMENT_DECLINED' } });
  });

  it('fails to an operator and keeps the seats when the charge outcome stays unknown', () => {
    const run = runOrchestrator(happy({ [A.charge]: exhausted }));

    expect(run.status).toBe('FAILED');
    expect(run.calls.at(-1)).toMatchObject({ name: A.fail, input: { releaseSeats: false } });
    expect(run.names).not.toContain(A.refund);
  });

  it('fails and releases the seats when the provider rejects the request (no money moved)', () => {
    const run = runOrchestrator(happy({ [A.charge]: () => ({ kind: 'rejected', code: 'validation_error' }) }));

    expect(run.calls.at(-1)).toMatchObject({ name: A.fail, input: { releaseSeats: true } });
  });
});

describe('checkout orchestrator: compensation', () => {
  it('refunds its own charge and ends REFUNDED when the seats cannot be booked', () => {
    const run = runOrchestrator(
      happy({ [A.confirmBooking]: () => ({ outcome: 'not_confirmable', chargeId: 'ch_1' }) }),
    );

    expect(run.status).toBe('REFUNDED');
    expect(run.names.slice(-2)).toEqual([A.refund, A.release]);
    expect(run.calls.find((c) => c.name === A.refund)?.input.chargeId).toBe('ch_1');
  });

  it('refunds and ends CANCELLED when the customer cancelled during payment', () => {
    const run = runOrchestrator(
      happy({ [A.confirmBooking]: () => ({ outcome: 'cancel_requested', chargeId: 'ch_1' }) }),
    );

    expect(run.status).toBe('CANCELLED');
    expect(run.names.slice(-2)).toEqual([A.refund, A.release]);
  });

  it('keeps money and seats for an operator when the refund cannot be made', () => {
    const run = runOrchestrator(
      happy({
        [A.confirmBooking]: () => ({ outcome: 'not_confirmable', chargeId: 'ch_1' }),
        [A.refund]: exhausted,
      }),
    );

    expect(run.status).toBe('FAILED');
    expect(run.calls.at(-1)).toMatchObject({ name: A.fail, input: { releaseSeats: false } });
    expect(String(run.calls.at(-1)?.input.reason)).toContain('ch_1');
  });

  it('neither refunds nor releases when the booking outcome is unknown', () => {
    const run = runOrchestrator(happy({ [A.confirmBooking]: exhausted }));

    expect(run.status).toBe('FAILED');
    expect(run.names).not.toContain(A.refund);
    expect(run.names).not.toContain(A.release);
  });
});

describe('checkout orchestrator: a step exhausts its retries', () => {
  it('fails and releases the seats when no charge was attempted', () => {
    const run = runOrchestrator(happy({ [A.release]: exhausted }, { first: 'timer' }));

    expect(run.status).toBe('FAILED');
    expect(run.calls.at(-1)).toMatchObject({ name: A.fail, input: { releaseSeats: true } });
    expect(String(run.calls.at(-1)?.input.reason)).toContain('awaiting payment');
  });

  it('fails without waiting when the seats could not even be held', () => {
    const run = runOrchestrator(happy({ [A.holdSeats]: exhausted }));

    expect(run.status).toBe('FAILED');
    expect(run.names).toEqual([A.holdSeats, A.fail]);
  });

  it('fails keeping the seats once a charge was attempted', () => {
    const run = runOrchestrator(happy({ [A.complete]: exhausted }));

    expect(run.status).toBe('FAILED');
    expect(run.calls.at(-1)).toMatchObject({ name: A.fail, input: { releaseSeats: false } });
    expect(run.names).not.toContain(A.refund);
  });

  it('records FAILED once: if that cannot be written either, the orchestration itself fails', () => {
    expect(() => runOrchestrator(happy({ [A.charge]: exhausted, [A.fail]: exhausted }))).toThrow();
    expect(() => runOrchestrator(happy({ [A.holdSeats]: exhausted, [A.fail]: exhausted }))).toThrow();
  });
});

describe('checkout orchestrator: ticket delivery', () => {
  it('confirms despite a mail outage and keeps redelivering on durable timers, bounded', () => {
    const run = runOrchestrator(happy({ [A.sendTicket]: exhausted }));

    expect(run.status).toBe('CONFIRMED');
    const completeAt = run.names.indexOf(A.complete);
    expect(run.names.indexOf(A.sendTicket)).toBeLessThan(completeAt);
    expect(run.names.slice(completeAt + 1)).toEqual([A.sendTicket, A.sendTicket, A.sendTicket]);
    expect(run.timers).toHaveLength(4); // hold timer + 3 redelivery delays
  });

  it('stops redelivering as soon as a delivery succeeds', () => {
    let attempts = 0;
    const run = runOrchestrator(
      happy({
        [A.sendTicket]: () => {
          attempts += 1;
          return attempts === 1 ? exhausted() : 'sent';
        },
      }),
    );

    expect(run.names.filter((n) => n === A.sendTicket)).toHaveLength(2);
  });
});
