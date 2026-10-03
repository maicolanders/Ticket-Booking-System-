import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CheckoutStatus, HoldStatus, SeatStatus } from '@ticket/shared';
import { prisma } from '../src/db/client';
import {
  beginCheckoutPayment,
  completeCheckout,
  confirmCheckoutBooking,
  createCheckout,
  expireAbandonedCheckouts,
  failCheckout,
  holdCheckoutSeats,
  releaseCheckout,
  requestCheckoutCancel,
} from '../src/checkout/checkout';
import { placeHold, releaseExpiredHolds } from '../src/holds/holds';
import { createShowFixture, createUser } from './fixtures';

const TTL = 60;

async function newCheckout(opts: { seats?: number; showId?: string; seatIds?: string[] } = {}) {
  const fixture = opts.showId ? null : await createShowFixture({ seats: opts.seats ?? 2, price: 12.5 });
  const showId = opts.showId ?? fixture!.show.id;
  const seatIds = opts.seatIds ?? fixture!.showSeatIds;
  const user = await createUser();
  const checkoutId = randomUUID();
  await createCheckout({ checkoutId, correlationId: randomUUID(), userId: user.id, showId, seatIds });
  return { checkoutId, userId: user.id, showId, seatIds };
}

const seats = async (ids: string[]) =>
  (await prisma.showSeat.findMany({ where: { id: { in: ids } } })).map((seat) => seat.status);

const lapse = (holdId: string) =>
  prisma.hold.update({ where: { id: holdId }, data: { expiresAt: new Date(Date.now() - 1_000) } });

describe('checkout lifecycle', () => {
  it('runs PENDING → AWAITING_PAYMENT → PROCESSING_PAYMENT → CONFIRMED, every step idempotent', async () => {
    const { checkoutId, seatIds } = await newCheckout({ seats: 2 });

    const held = await holdCheckoutSeats(checkoutId, TTL);
    expect(held).toMatchObject({ status: CheckoutStatus.AWAITING_PAYMENT, amountDue: 2500 });
    expect((await holdCheckoutSeats(checkoutId, TTL)).holdId).toBe(held.holdId);

    expect((await beginCheckoutPayment(checkoutId)).outcome).toBe('processing');
    expect((await beginCheckoutPayment(checkoutId)).outcome).toBe('processing');
    expect((await prisma.hold.findUniqueOrThrow({ where: { id: held.holdId! } })).status).toBe(
      HoldStatus.CAPTURING,
    );

    const confirmed = await confirmCheckoutBooking(checkoutId, `ch_${checkoutId}`);
    const again = await confirmCheckoutBooking(checkoutId, `ch_${checkoutId}`);
    expect(confirmed.outcome).toBe('booked');
    expect(again.checkout.bookingId).toBe(confirmed.checkout.bookingId);
    expect(confirmed.checkout.status).toBe(CheckoutStatus.PROCESSING_PAYMENT);

    expect((await completeCheckout(checkoutId)).status).toBe(CheckoutStatus.CONFIRMED);
    expect((await completeCheckout(checkoutId)).status).toBe(CheckoutStatus.CONFIRMED);
    expect(await seats(seatIds)).toEqual([SeatStatus.BOOKED, SeatStatus.BOOKED]);
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: confirmed.checkout.bookingId! } });
    expect(booking.chargeId).toBe(`ch_${checkoutId}`);
  });

  it('holds a contested seat for exactly one of several concurrent checkouts', async () => {
    const first = await newCheckout({ seats: 1 });
    const others = await Promise.all(
      Array.from({ length: 5 }, () => newCheckout({ showId: first.showId, seatIds: first.seatIds })),
    );

    const results = await Promise.all(
      [first, ...others].map(({ checkoutId }) => holdCheckoutSeats(checkoutId, TTL)),
    );

    expect(results.filter((c) => c.status === CheckoutStatus.AWAITING_PAYMENT)).toHaveLength(1);
    expect(results.filter((c) => c.status === CheckoutStatus.REJECTED)).toHaveLength(5);
    expect(results.find((c) => c.status === CheckoutStatus.REJECTED)?.failureReason).toMatch(/no longer available/);
  });
});

describe('hold expiry', () => {
  it('expires a checkout whose hold lapsed before payment began, by the database clock', async () => {
    const { checkoutId, seatIds } = await newCheckout({ seats: 1 });
    const held = await holdCheckoutSeats(checkoutId, TTL);
    await lapse(held.holdId!);

    const result = await beginCheckoutPayment(checkoutId);

    expect(result).toMatchObject({ outcome: 'expired', checkout: { status: CheckoutStatus.EXPIRED } });
    expect(await seats(seatIds)).toEqual([SeatStatus.AVAILABLE]);
  });

  it('leaves checkout holds to their orchestration: the sweeper skips them', async () => {
    const { checkoutId, showId, seatIds } = await newCheckout({ seats: 1 });
    const held = await holdCheckoutSeats(checkoutId, TTL);
    await lapse(held.holdId!);

    await releaseExpiredHolds(showId);

    expect(await seats(seatIds)).toEqual([SeatStatus.HELD]);
  });

  it('never frees a CAPTURING hold, even past its expiry, while payment is in flight', async () => {
    const { checkoutId, showId, seatIds } = await newCheckout({ seats: 1 });
    const held = await holdCheckoutSeats(checkoutId, TTL);
    await beginCheckoutPayment(checkoutId);
    await lapse(held.holdId!);
    const rival = await createUser();

    await releaseExpiredHolds(showId);
    await expect(placeHold({ userId: rival.id, showId, seatIds, ttlSeconds: TTL })).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(await seats(seatIds)).toEqual([SeatStatus.HELD]);
  });
});

describe('ending a checkout without a booking', () => {
  it('releases seats once and ignores repeats', async () => {
    const { checkoutId, seatIds } = await newCheckout({ seats: 2 });
    await holdCheckoutSeats(checkoutId, TTL);

    const cancelled = await releaseCheckout(checkoutId, CheckoutStatus.CANCELLED);
    const repeat = await releaseCheckout(checkoutId, CheckoutStatus.EXPIRED);

    expect(cancelled.status).toBe(CheckoutStatus.CANCELLED);
    expect(repeat.status).toBe(CheckoutStatus.CANCELLED);
    expect(await seats(seatIds)).toEqual([SeatStatus.AVAILABLE, SeatStatus.AVAILABLE]);
  });

  it('lets a cancellation requested during payment win over booking', async () => {
    const { checkoutId, userId, seatIds } = await newCheckout({ seats: 1 });
    await holdCheckoutSeats(checkoutId, TTL);
    await beginCheckoutPayment(checkoutId);

    expect(await requestCheckoutCancel(checkoutId, userId)).toBe('accepted');
    const result = await confirmCheckoutBooking(checkoutId, `ch_${checkoutId}`);
    const released = await releaseCheckout(checkoutId, CheckoutStatus.CANCELLED);

    expect(result.outcome).toBe('cancel_requested');
    expect(result.checkout.chargeId).toBe(`ch_${checkoutId}`);
    expect(released.bookingId).toBeNull();
    expect(await seats(seatIds)).toEqual([SeatStatus.AVAILABLE]);
  });

  it('refuses cancellation from another customer, after booking, and when terminal', async () => {
    const { checkoutId, userId } = await newCheckout({ seats: 1 });
    await holdCheckoutSeats(checkoutId, TTL);
    const stranger = await createUser();

    expect(await requestCheckoutCancel(checkoutId, stranger.id)).toBe('not_found');
    await beginCheckoutPayment(checkoutId);
    await confirmCheckoutBooking(checkoutId, `ch_${checkoutId}`);
    expect(await requestCheckoutCancel(checkoutId, userId)).toBe('too_late');
    await completeCheckout(checkoutId);
    expect(await requestCheckoutCancel(checkoutId, userId)).toBe('too_late');
  });

  it('keeps seats held when failing to an operator, so a possibly-paid seat is not resold', async () => {
    const { checkoutId, seatIds } = await newCheckout({ seats: 1 });
    await holdCheckoutSeats(checkoutId, TTL);
    await beginCheckoutPayment(checkoutId);

    const failed = await failCheckout(checkoutId, 'payment outcome unknown');

    expect(failed).toMatchObject({ status: CheckoutStatus.FAILED, failureReason: 'payment outcome unknown' });
    expect(await seats(seatIds)).toEqual([SeatStatus.HELD]);
  });
});

describe('failing with no money moved', () => {
  it('can release the seats', async () => {
    const { checkoutId, seatIds } = await newCheckout({ seats: 1 });
    await holdCheckoutSeats(checkoutId, TTL);
    await beginCheckoutPayment(checkoutId);

    await failCheckout(checkoutId, 'payment rejected: validation_error', { releaseSeats: true });

    expect(await seats(seatIds)).toEqual([SeatStatus.AVAILABLE]);
  });
});

describe('expireAbandonedCheckouts', () => {
  const ageHold = (holdId: string, checkoutId: string, secondsAgo: number) => {
    const at = new Date(Date.now() - secondsAgo * 1000);
    return Promise.all([
      prisma.hold.update({ where: { id: holdId }, data: { expiresAt: at } }),
      prisma.checkout.update({ where: { id: checkoutId }, data: { holdExpiresAt: at } }),
    ]);
  };

  it('expires checkouts left awaiting payment past the grace period, and nothing else', async () => {
    const abandoned = await newCheckout({ seats: 1 });
    const recent = await newCheckout({ seats: 1 });
    const paying = await newCheckout({ seats: 1 });
    for (const c of [abandoned, recent, paying]) await holdCheckoutSeats(c.checkoutId, TTL);
    await beginCheckoutPayment(paying.checkoutId);
    const holdOf = async (id: string) => (await prisma.checkout.findUniqueOrThrow({ where: { id } })).holdId!;
    await ageHold(await holdOf(abandoned.checkoutId), abandoned.checkoutId, 600);
    await ageHold(await holdOf(recent.checkoutId), recent.checkoutId, 5);
    await ageHold(await holdOf(paying.checkoutId), paying.checkoutId, 600);

    const expired = await expireAbandonedCheckouts(120);

    expect(expired.map((c) => c.id)).toContain(abandoned.checkoutId);
    expect(expired.map((c) => c.id)).not.toContain(recent.checkoutId);
    expect(await seats(abandoned.seatIds)).toEqual([SeatStatus.AVAILABLE]);
    const statusOf = async (id: string) => (await prisma.checkout.findUniqueOrThrow({ where: { id } })).status;
    expect(await statusOf(recent.checkoutId)).toBe(CheckoutStatus.AWAITING_PAYMENT);
    expect(await statusOf(paying.checkoutId)).toBe(CheckoutStatus.PROCESSING_PAYMENT);
  });
});
