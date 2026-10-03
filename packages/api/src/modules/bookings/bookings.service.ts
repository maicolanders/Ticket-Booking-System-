import {
  prisma,
  quoteSeats,
  isHoldActive,
  convertHoldToBooking,
  cancelBooking as cancelConfirmedBooking,
} from '@ticket/domain';
import { notFound, forbidden, conflict, gone, rethrowAsHttp } from '../../lib/errors';
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
import { randomUUID } from 'node:crypto';
import { chargePayment, refundPayment } from '../../lib/payments';
import { logger } from '../../lib/logger';

export { getBookingDetail, getBookingByReference };

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
  const idempotencyKey = randomUUID();
  const charge = await chargePayment(
    { amount: totalMinor, currency: 'USD', paymentToken, metadata: { holdId } },
    idempotencyKey,
  );

  const booking = await convertHoldToBooking(holdId).catch(async (error: unknown) => {
    try {
      await refundPayment(charge.id, `${idempotencyKey}:refund`);
    } catch (refundError) {
      logger.error('Failed to refund payment after booking failure:', refundError);
    }
    return rethrowAsHttp(error);
  });
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
