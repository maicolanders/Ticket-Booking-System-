import { prisma, bookingReference, signTicketToken, runInTransaction, lockSeats } from '@ticket/domain';
import { notFound, forbidden, conflict, gone } from '../../lib/errors';
import { emitSeatUpdate } from '../../realtime/io';
import { SeatStatus, HoldStatus, BookingStatus, SocketEvents, type BookingDTO } from '@ticket/shared';
import {
  bookingInclude,
  toBookingDTO,
  getBookingDetail,
  getBookingByReference,
  sendTicketEmail,
  priceMap,
  withReferenceRetry,
} from './bookings.shared';
import { offerSeatsToWaitlist } from '../waitlist/waitlist.service';
import { randomUUID } from 'node:crypto';
import { chargePayment, refundPayment } from '../../lib/payments';
import { logger } from '../../lib/logger';
import { toMoney } from '../../lib/money';

export { getBookingDetail, getBookingByReference };

/**
 * Convert an active hold into a confirmed booking. Runs in a transaction that
 * re-locks the held seats FOR UPDATE, so it can't race the TTL sweeper or a
 * concurrent booking. Returns the ids needed for the post-commit side effects.
 */
async function confirmBookingTxn(userId: string, holdId: string) {
  return runInTransaction(async (tx) => {
    const hold = await tx.hold.findUnique({
      where: { id: holdId },
      include: { seats: { select: { id: true } } },
    });
    if (!hold) throw notFound('Hold not found');
    if (hold.userId !== userId) throw forbidden('This hold does not belong to you');
    if (hold.status !== HoldStatus.ACTIVE) throw conflict('This hold is no longer active');
    if (hold.expiresAt.getTime() <= Date.now()) throw gone('Your seat hold has expired');

    const seatIds = hold.seats.map((s) => s.id);
    if (seatIds.length === 0) throw conflict('This hold has no seats');

    // Pessimistic lock on the held seats — serializes against the sweeper.
    const locked = await lockSeats(tx, seatIds);
    const stillHeld =
      locked.length === seatIds.length &&
      locked.every((s) => s.status === SeatStatus.HELD && s.holdId === holdId);
    if (!stillHeld) {
      throw gone('Your held seats are no longer valid — the hold may have expired');
    }

    const prices = await priceMap(tx, hold.showId);
    const seatRows = await tx.showSeat.findMany({
      where: { id: { in: seatIds } },
      select: { id: true, seatCategoryId: true },
    });
    const bookingSeats = seatRows.map((s) => ({
      showSeatId: s.id,
      priceAtBooking: prices.get(s.seatCategoryId) ?? 0,
    }));
    const total = bookingSeats.reduce((sum, b) => sum + b.priceAtBooking, 0);

    const reference = bookingReference();
    const booking = await tx.booking.create({
      data: {
        reference,
        showId: hold.showId,
        userId,
        status: BookingStatus.CONFIRMED,
        totalAmount: total,
        qrToken: signTicketToken(reference),
        seats: { create: bookingSeats },
      },
    });
    await tx.showSeat.updateMany({
      where: { id: { in: seatIds } },
      data: { status: SeatStatus.BOOKED, holdId: null },
    });
    await tx.hold.update({ where: { id: holdId }, data: { status: HoldStatus.CONVERTED } });

    return { bookingId: booking.id, showId: hold.showId, seatIds };
  });
}

/** Confirm a booking from a hold, then emit + email the QR ticket. */
export async function createBooking(
  userId: string,
  holdId: string,
  paymentToken: string,
): Promise<BookingDTO> {
  const hold = await prisma.hold.findUnique({
    where: { id: holdId },
    include: { seats: { select: { seatCategoryId: true } } },
  });
  if (!hold) throw notFound('Hold not found');
  if (hold.userId !== userId) throw forbidden('This hold does not belong to you');
  if (hold.status !== HoldStatus.ACTIVE) throw conflict('This hold is no longer active');
  if (hold.expiresAt.getTime() <= Date.now()) throw gone('Your seat hold has expired');

  const pricing = await prisma.showPricing.findMany({ where: { showId: hold.showId } });
  const prices = new Map(pricing.map((price) => [price.seatCategoryId, toMoney(price.price)]));
  const amount = hold.seats.reduce((sum, seat) => sum + (prices.get(seat.seatCategoryId) ?? 0), 0);
  const idempotencyKey = randomUUID();
  const charge = await chargePayment(
    { amount: Math.round(amount * 100), currency: 'USD', paymentToken, metadata: { holdId } },
    idempotencyKey,
  );

  let result: Awaited<ReturnType<typeof confirmBookingTxn>>;
  try {
    result = await withReferenceRetry(() => confirmBookingTxn(userId, holdId));
  } catch (error) {
    try {
      await refundPayment(charge.id, `${idempotencyKey}:refund`);
    } catch (refundError) {
      logger.error('Failed to refund payment after booking failure:', refundError);
    }
    throw error;
  }
  const { bookingId, showId, seatIds } = result;
  emitSeatUpdate(SocketEvents.SEAT_BOOKED, showId, seatIds, SeatStatus.BOOKED);
  await sendTicketEmail(bookingId);
  return getBookingDetail(bookingId, userId);
}

/** A customer's booking history (summaries — no QR payload). */
export async function listBookings(userId: string): Promise<BookingDTO[]> {
  const bookings = await prisma.booking.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: bookingInclude,
  });
  return bookings.map((b) => toBookingDTO(b));
}

/**
 * Cancel a confirmed booking: free its seats in a locked transaction, then hand
 * them to the waitlist (which creates time-limited offers + emails, and emits
 * the appropriate realtime updates per seat).
 */
export async function cancelBooking(userId: string, bookingId: string): Promise<BookingDTO> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { seats: { select: { showSeatId: true } } },
  });
  if (!booking) throw notFound('Booking not found');
  if (booking.userId !== userId) throw forbidden('This booking does not belong to you');
  if (booking.status !== BookingStatus.CONFIRMED) throw conflict('This booking is already cancelled');

  const showSeatIds = booking.seats.map((s) => s.showSeatId);

  await runInTransaction(async (tx) => {
    if (showSeatIds.length > 0) {
      // Lock so freeing the seats can't race a concurrent hold on them.
      await lockSeats(tx, showSeatIds);
      await tx.showSeat.updateMany({
        where: { id: { in: showSeatIds } },
        data: { status: SeatStatus.AVAILABLE, holdId: null },
      });
    }
    await tx.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.CANCELLED, cancelledAt: new Date() },
    });
  });

  // Offer freed seats to waitlisted customers (per-seat FIFO). Emits realtime
  // SEAT_OFFERED for claimed seats and SEAT_RELEASED for the rest.
  if (showSeatIds.length > 0) {
    await offerSeatsToWaitlist(booking.showId, showSeatIds);
  }

  return getBookingDetail(bookingId, userId);
}
