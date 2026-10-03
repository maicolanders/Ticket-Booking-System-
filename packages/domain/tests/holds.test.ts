import { describe, expect, it } from 'vitest';
import { HoldStatus, SeatStatus } from '@ticket/shared';
import { prisma } from '../src/db/client';
import { runInTransaction } from '../src/db/transaction';
import { placeHold, releaseHold } from '../src/holds/holds';
import { holdSeats } from '../src/seats/seats';
import { createShowFixture, createUser } from './fixtures';

const hold = async (seats = 2) => {
  const { show, showSeatIds } = await createShowFixture({ seats, price: 10 });
  const user = await createUser();
  const placed = await placeHold({ userId: user.id, showId: show.id, seatIds: showSeatIds, ttlSeconds: 60 });
  return { show, showSeatIds, user, placed };
};

describe('placeHold', () => {
  it('holds all seats and quotes them in minor units', async () => {
    const { showSeatIds, placed } = await hold(2);

    expect(placed.quote.totalMinor).toBe(2000);
    const seats = await prisma.showSeat.findMany({ where: { id: { in: showSeatIds } } });
    expect(seats.every((seat) => seat.status === SeatStatus.HELD && seat.holdId === placed.holdId)).toBe(true);
  });

  it('refuses with a conflict naming the unavailable seats', async () => {
    const { show, showSeatIds } = await hold(2);
    const other = await createUser();

    await expect(
      placeHold({ userId: other.id, showId: show.id, seatIds: showSeatIds, ttlSeconds: 60 }),
    ).rejects.toMatchObject({ code: 'conflict', details: { seatIds: expect.arrayContaining(showSeatIds) } });
  });
});

describe('releaseHold', () => {
  it('releases exactly once when called concurrently, and is a no-op afterwards', async () => {
    const { showSeatIds, placed } = await hold(2);

    const results = await Promise.all([
      releaseHold(placed.holdId, HoldStatus.EXPIRED),
      releaseHold(placed.holdId, HoldStatus.RELEASED),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.find(Boolean)?.seatIds.sort()).toEqual([...showSeatIds].sort());
    expect(await releaseHold(placed.holdId, HoldStatus.EXPIRED)).toBeNull();
    const seats = await prisma.showSeat.findMany({ where: { id: { in: showSeatIds } } });
    expect(seats.every((seat) => seat.status === SeatStatus.AVAILABLE && seat.holdId === null)).toBe(true);
  });
});

describe('seat transitions', () => {
  it('refuse to overwrite a seat that is not in the expected state', async () => {
    const { showSeatIds, placed } = await hold(1);

    await expect(runInTransaction((tx) => holdSeats(tx, showSeatIds, 'another-hold'))).rejects.toThrow(
      'AVAILABLE→HELD',
    );
    const seat = await prisma.showSeat.findUniqueOrThrow({ where: { id: showSeatIds[0] } });
    expect(seat.holdId).toBe(placed.holdId);
  });
});
