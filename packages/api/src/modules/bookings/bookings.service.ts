import {
  prisma,
  quoteSeats,
  isHoldActive,
  convertHoldToBooking,
  cancelBooking as cancelConfirmedBooking,
  TransientPaymentError,
  type CreatedBooking,
} from '@ticket/domain';
import {
  HttpError,
  notFound,
  forbidden,
  conflict,
  gone,
  paymentRequired,
  rethrowAsHttp,
} from '../../lib/errors';
import { emitSeatUpdate } from '../../realtime/io';
import { SeatStatus, HoldStatus, SocketEvents, type BookingDTO } from '@ticket/shared';
import {
  bookingInclude,
  toBookingDTO,
  getBookingDetail,
  getBookingByReference,
  sendTicketEmail,
} from './bookings.shared';
import { offerSeatsToWaitlist } from '../waitlist/waitlist.service';
import { createHash } from 'node:crypto';
import { paymentGateway } from '../../lib/payments';
import { logger } from '../../lib/logger';

export { getBookingDetail, getBookingByReference };

/**
 * Deterministic per (hold, card): a repeated request replays the same charge instead
 * of creating a second one, while retrying with a different card is a new attempt.
 * The token is hashed so it never appears in provider logs.
 */
const legacyChargeKey = (holdId: string, paymentToken: string) =>
  `hold:${holdId}:charge:${createHash('sha256').update(paymentToken).digest('hex').slice(0, 16)}`;

/** Confirm a booking from a hold, then emit + email the QR ticket. */
export async function createBooking(
  userId: string,
  holdId: string,
  paymentToken: string,
): Promise<BookingDTO> {
  const hold = await prisma.hold.findUnique({
    where: { id: holdId },
    include: { seats: { select: { id: true } } },
  });
  if (!hold) throw notFound('Hold not found');
  if (hold.userId !== userId) throw forbidden('This hold does not belong to you');
  if (hold.status !== HoldStatus.ACTIVE) throw conflict('This hold is no longer active');
  if (!isHoldActive(hold)) throw gone('Your seat hold has expired');

  const { totalMinor } = await quoteSeats(
    prisma,
    hold.showId,
    hold.seats.map((seat) => seat.id),
  );
  const idempotencyKey = legacyChargeKey(holdId, paymentToken);
  const correlationId = `hold:${holdId}`;
  const outcome = await paymentGateway
    .charge({
      idempotencyKey,
      correlationId,
      amountMinor: totalMinor,
      currency: 'USD',
      paymentToken,
      metadata: { holdId },
    })
    .catch((error: unknown) => {
      logger.error('Payment provider call failed:', error);
      throw error instanceof TransientPaymentError
        ? new HttpError(503, 'The payment provider is unavailable, please retry')
        : new HttpError(502, 'The payment provider rejected the request');
    });
  if (outcome.kind === 'declined') throw paymentRequired('Your payment was declined');

  let booking: CreatedBooking;
  try {
    booking = await convertHoldToBooking(holdId, { chargeId: outcome.chargeId });
  } catch (error) {
    // A repeated or concurrent request reuses the same charge (same idempotency key).
    // If that charge already paid for a booking, this request is a replay: answer with
    // that booking. Refunding here would take the money for a booking that stands.
    const paid = await prisma.booking.findUnique({ where: { chargeId: outcome.chargeId } });
    if (paid) return getBookingDetail(paid.id, userId);
    try {
      await paymentGateway.refund({
        idempotencyKey: `${idempotencyKey}:refund`,
        correlationId,
        chargeId: outcome.chargeId,
      });
    } catch (refundError) {
      logger.error('Failed to refund payment after booking failure:', refundError);
    }
    return rethrowAsHttp(error);
  }
  emitSeatUpdate(SocketEvents.SEAT_BOOKED, booking.showId, booking.seatIds, SeatStatus.BOOKED);
  await sendTicketEmail(booking.bookingId);
  return getBookingDetail(booking.bookingId, userId);
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
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { userId: true } });
  if (!booking) throw notFound('Booking not found');
  if (booking.userId !== userId) throw forbidden('This booking does not belong to you');

  const { showId, seatIds } = await cancelConfirmedBooking(bookingId).catch(rethrowAsHttp);

  // Offer freed seats to waitlisted customers (per-seat FIFO). Emits realtime
  // SEAT_OFFERED for claimed seats and SEAT_RELEASED for the rest.
  if (seatIds.length > 0) {
    await offerSeatsToWaitlist(showId, seatIds);
  }

  return getBookingDetail(bookingId, userId);
}
