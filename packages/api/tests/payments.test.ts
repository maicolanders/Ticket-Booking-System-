import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/mailer', () => ({ sendMail: vi.fn(async () => {}) }));

import { createHold } from '../src/modules/holds/holds.service';
import { createBooking } from '../src/modules/bookings/bookings.service';
import { prisma } from '@ticket/domain';
import { HoldStatus } from '@ticket/shared';
import { createShowFixture, createUser } from '@ticket/domain/testing';

const simulator = process.env.PAYMENT_API_URL ?? 'http://localhost:4100';

async function chargesForHold(holdId: string) {
  const ledger = (await (await fetch(`${simulator}/__admin/ledger`)).json()) as {
    charges: Array<{ id: string; metadata: Record<string, string> }>;
    refunds: Array<{ chargeId: string }>;
  };
  const charges = ledger.charges.filter((charge) => charge.metadata.holdId === holdId);
  const refunded = charges.filter((charge) => ledger.refunds.some((refund) => refund.chargeId === charge.id));
  return { charges, net: charges.length - refunded.length };
}

/** Legacy POST /bookings charge: stable idempotency keys and typed provider outcomes. */
describe('legacy booking payment', () => {
  it('answers a decline with 402 and keeps the hold for another card', async () => {
    const { show, showSeatIds } = await createShowFixture({ seats: 1 });
    const user = await createUser('CUSTOMER');
    const hold = await createHold(user.id, show.id, showSeatIds);

    await expect(createBooking(user.id, hold.id, 'tok_decline')).rejects.toMatchObject({ status: 402 });
    expect((await prisma.hold.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe(HoldStatus.ACTIVE);

    await expect(createBooking(user.id, hold.id, 'tok_ok')).resolves.toMatchObject({ status: 'CONFIRMED' });
    expect((await chargesForHold(hold.id)).charges).toHaveLength(1);
  });

  it('replays one booking and one net charge when the same booking is submitted concurrently', async () => {
    const { show, showSeatIds } = await createShowFixture({ seats: 1 });
    const user = await createUser('CUSTOMER');
    const hold = await createHold(user.id, show.id, showSeatIds);

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => createBooking(user.id, hold.id, 'tok_ok')),
    );

    const references = results.map((result) =>
      result.status === 'fulfilled' ? result.value.reference : null,
    );
    expect(new Set(references).size).toBe(1);
    expect(references[0]).toMatch(/^BK-/);
    expect((await chargesForHold(hold.id)).net).toBe(1);
  });
});
