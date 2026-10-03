import { prisma, bookingInclude, deliverTicket, generateQrDataUrl, type FullBooking } from '@ticket/domain';
import { notFound, forbidden } from '../../lib/errors';
import { toMoney } from '../../lib/money';
import { mailer } from '../../lib/mailer';
import { logger } from '../../lib/logger';
import { isProd } from '../../config/env';
import type { BookingDTO } from '@ticket/shared';

// Shared booking-loading, mapping, and email helpers. Kept free of waitlist
// imports so both the bookings and waitlist modules can use them without a cycle.

export { bookingInclude };

export function toBookingDTO(b: FullBooking, qrDataUrl?: string): BookingDTO {
  return {
    id: b.id,
    reference: b.reference,
    status: b.status,
    totalAmount: toMoney(b.totalAmount),
    createdAt: b.createdAt.toISOString(),
    cancelledAt: b.cancelledAt ? b.cancelledAt.toISOString() : null,
    show: {
      id: b.show.id,
      startsAt: b.show.startsAt.toISOString(),
      eventTitle: b.show.event.title,
      eventType: b.show.event.type,
      venueName: b.show.venue.name,
    },
    seats: b.seats.map((s) => ({
      rowLabel: s.showSeat.venueSeat.rowLabel,
      colNumber: s.showSeat.venueSeat.colNumber,
      categoryName: s.showSeat.seatCategory.name,
      price: toMoney(s.priceAtBooking),
    })),
    qrDataUrl,
  };
}

/** Load a booking, authorize the owner, and attach a freshly rendered QR data URL. */
export async function getBookingDetail(bookingId: string, userId: string): Promise<BookingDTO> {
  const b = await prisma.booking.findUnique({ where: { id: bookingId }, include: bookingInclude });
  if (!b) throw notFound('Booking not found');
  if (b.userId !== userId) throw forbidden('This booking does not belong to you');
  const qrDataUrl = await generateQrDataUrl(b.qrToken);
  return toBookingDTO(b, qrDataUrl);
}

export async function getBookingByReference(reference: string, userId: string): Promise<BookingDTO> {
  const b = await prisma.booking.findUnique({ where: { reference }, include: bookingInclude });
  if (!b) throw notFound('Booking not found');
  if (b.userId !== userId) throw forbidden('This booking does not belong to you');
  const qrDataUrl = await generateQrDataUrl(b.qrToken);
  return toBookingDTO(b, qrDataUrl);
}

/**
 * Email the QR ticket once (see deliverTicket). Outside production a mail outage
 * is logged, not raised, so it never blocks a legacy booking.
 */
export async function sendTicketEmail(bookingId: string): Promise<void> {
  try {
    await deliverTicket(bookingId, mailer);
  } catch (err) {
    logger.error('ticket.delivery.failed', { bookingId, err });
    if (isProd) throw err;
  }
}

