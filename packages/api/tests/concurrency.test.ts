import { describe, it, expect } from 'vitest';
import { createHold } from '../src/modules/holds/holds.service';
import { HttpError } from '../src/lib/errors';
import { prisma } from '../src/lib/prisma';
import { SeatStatus } from '@ticket/shared';
import { createShowFixture, createUser } from './helpers';

/**
 * Concurrency: two customers must never both hold the same seat. We fire N hold
 * requests for one seat in parallel; they contend on the `SELECT … FOR UPDATE`
 * row lock, so exactly one wins and the rest get a 409 conflict.
 */
describe('seat-hold concurrency', () => {
  it('permits exactly one of N concurrent holds on the same seat', async () => {
    const { show, showSeatIds } = await createShowFixture({ seats: 3 });
    const target = showSeatIds[0];
    const N = 8;

    const users = await Promise.all(
      Array.from({ length: N }, () => createUser('CUSTOMER')),
    );

    const results = await Promise.allSettled(
      users.map((u) => createHold(u.id, show.id, [target])),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(N - 1);

    // Every loser fails with a 409 Conflict (not some other error).
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(HttpError);
      expect((r.reason as HttpError).status).toBe(409);
    }

    // The seat ends up HELD, tied to exactly one hold.
    const seat = await prisma.showSeat.findUnique({ where: { id: target } });
    expect(seat?.status).toBe(SeatStatus.HELD);
    expect(seat?.holdId).toBeTruthy();

    const activeHolds = await prisma.hold.count({
      where: { showId: show.id, status: 'ACTIVE' },
    });
    expect(activeHolds).toBe(1);
  });

  it('lets concurrent holds on disjoint seats all succeed', async () => {
    const { show, showSeatIds } = await createShowFixture({ seats: 5 });
    const customer = await createUser('CUSTOMER');

    const results = await Promise.allSettled(
      showSeatIds.map((id) => createHold(customer.id, show.id, [id])),
    );

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    const held = await prisma.showSeat.count({
      where: { showId: show.id, status: SeatStatus.HELD },
    });
    expect(held).toBe(showSeatIds.length);
  });

  it('rejects a multi-seat hold if any one seat is already taken (all-or-nothing)', async () => {
    const { show, showSeatIds } = await createShowFixture({ seats: 3 });
    const a = await createUser('CUSTOMER');
    const b = await createUser('CUSTOMER');

    // A holds the middle seat.
    await createHold(a.id, show.id, [showSeatIds[1]]);

    // B asks for all three — must fail atomically and hold none.
    await expect(createHold(b.id, show.id, showSeatIds)).rejects.toMatchObject({
      status: 409,
    });

    const heldByB = await prisma.showSeat.count({
      where: { showId: show.id, hold: { userId: b.id } },
    });
    expect(heldByB).toBe(0);
  });
});
