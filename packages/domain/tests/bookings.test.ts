import { describe, expect, it } from 'vitest';
import { BookingStatus, HoldStatus, SeatStatus } from '@ticket/shared';
import { prisma } from '../src/db/client';
import { cancelBooking, convertHoldToBooking } from '../src/bookings/bookings';
import { placeHold } from '../src/holds/holds';
import { createShowFixture, createUser } from './fixtures';

async function heldSeats(seats = 2) {
  const { show, showSeatIds } = await createShowFixture({ seats, price: 25 });
  const user = await createUser();
  const hold = await placeHold({ userId: user.id, showId: show.id, seatIds: showSeatIds, ttlSeconds: 60 });
  return { showSeatIds, user, hold };
}

const seatStatuses = async (ids: string[]) =>
  (await prisma.showSeat.findMany({ where: { id: { in: ids } } })).map((seat) => seat.status);

describe('convertHoldToBooking', () => {
  it('books the held seats at the quoted price, paid by the given charge', async () => {
    const { showSeatIds, user, hold } = await heldSeats(2);
    const chargeId = `ch_${hold.holdId}`;

    const booking = await convertHoldToBooking(hold.holdId, { chargeId });

    expect(booking.totalMinor).toBe(5000);
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.bookingId } });
    expect(stored).toMatchObject({ userId: user.id, status: BookingStatus.CONFIRMED, chargeId });
    expect(stored.totalAmount.toString()).toBe('50');
    expect(await seatStatuses(showSeatIds)).toEqual([SeatStatus.BOOKED, SeatStatus.BOOKED]);
    expect((await prisma.hold.findUniqueOrThrow({ where: { id: hold.holdId } })).status).toBe(HoldStatus.CONVERTED);
  });

  it('creates exactly one booking when the same hold is converted concurrently', async () => {
    const { hold } = await heldSeats(1);

    const results = await Promise.allSettled([convertHoldToBooking(hold.holdId), convertHoldToBooking(hold.holdId)]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'conflict' } });
    expect(await prisma.booking.count({ where: { seats: { some: { showSeatId: hold.seatIds[0] } } } })).toBe(1);
  });

  it('refuses an expired hold and books nothing', async () => {
    const { showSeatIds, hold } = await heldSeats(1);
    await prisma.hold.update({ where: { id: hold.holdId }, data: { expiresAt: new Date(Date.now() - 1_000) } });

    await expect(convertHoldToBooking(hold.holdId)).rejects.toMatchObject({ code: 'expired' });
    expect(await seatStatuses(showSeatIds)).toEqual([SeatStatus.HELD]);
  });
});

describe('cancelBooking', () => {
  it('frees the seats once and refuses a second cancellation', async () => {
    const { showSeatIds, hold } = await heldSeats(2);
    const booking = await convertHoldToBooking(hold.holdId);

    const cancelled = await cancelBooking(booking.bookingId);

    expect(cancelled.seatIds.sort()).toEqual([...showSeatIds].sort());
    expect(await seatStatuses(showSeatIds)).toEqual([SeatStatus.AVAILABLE, SeatStatus.AVAILABLE]);
    await expect(cancelBooking(booking.bookingId)).rejects.toMatchObject({ code: 'conflict' });
  });
});
