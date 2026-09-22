import { describe, it, expect } from 'vitest';
import { createHold, releaseExpiredHolds } from '../src/modules/holds/holds.service';
import { prisma } from '../src/lib/prisma';
import { SeatStatus, HoldStatus } from '@ticket/shared';
import { createShowFixture, createUser } from './helpers';

/**
 * TTL / auto-release: a hold that outlives its TTL must free its seats. We drive
 * the same code path the background sweeper uses (`releaseExpiredHolds`) after
 * back-dating a hold's `expiresAt`, and also assert the lazy-expiry backstop.
 */
describe('hold TTL auto-release', () => {
  it('sweeper releases an expired hold and frees its seats', async () => {
    const { show, showSeatIds } = await createShowFixture({ seats: 2 });
    const customer = await createUser('CUSTOMER');

    const hold = await createHold(customer.id, show.id, showSeatIds);
    // Back-date the hold so it is now expired.
    await prisma.hold.update({
      where: { id: hold.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const released = await releaseExpiredHolds();
    expect(released).toBeGreaterThanOrEqual(1);

    const seats = await prisma.showSeat.findMany({ where: { id: { in: showSeatIds } } });
    expect(seats.every((s) => s.status === SeatStatus.AVAILABLE)).toBe(true);
    expect(seats.every((s) => s.holdId === null)).toBe(true);

    const after = await prisma.hold.findUnique({ where: { id: hold.id } });
    expect(after?.status).toBe(HoldStatus.EXPIRED);
  });

  it('does not release a still-valid hold', async () => {
    const { show, showSeatIds } = await createShowFixture({ seats: 1 });
    const customer = await createUser('CUSTOMER');

    const hold = await createHold(customer.id, show.id, showSeatIds);
    await releaseExpiredHolds();

    const after = await prisma.hold.findUnique({ where: { id: hold.id } });
    expect(after?.status).toBe(HoldStatus.ACTIVE);
    const seat = await prisma.showSeat.findUnique({ where: { id: showSeatIds[0] } });
    expect(seat?.status).toBe(SeatStatus.HELD);
  });

  it('lazily expires a stale hold when another customer grabs the same seat', async () => {
    const { show, showSeatIds } = await createShowFixture({ seats: 1 });
    const a = await createUser('CUSTOMER');
    const b = await createUser('CUSTOMER');

    const staleHold = await createHold(a.id, show.id, showSeatIds);
    await prisma.hold.update({
      where: { id: staleHold.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    // B can hold the seat: the expired hold is released inside B's transaction.
    const bHold = await createHold(b.id, show.id, showSeatIds);
    expect(bHold.seatIds).toEqual(showSeatIds);

    const staleAfter = await prisma.hold.findUnique({ where: { id: staleHold.id } });
    expect(staleAfter?.status).toBe(HoldStatus.EXPIRED);
    const seat = await prisma.showSeat.findUnique({ where: { id: showSeatIds[0] } });
    expect(seat?.holdId).toBe(bHold.id);
  });
});
