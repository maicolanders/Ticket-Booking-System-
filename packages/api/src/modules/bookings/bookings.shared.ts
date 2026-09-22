import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { notFound, forbidden } from '../../lib/errors';
import { toMoney } from '../../lib/money';
import { generateQrDataUrl, generateQrBuffer } from '../../lib/qr';
import { sendMail } from '../../lib/mailer';
import { ticketEmailHtml } from '../../lib/emailTemplates';
import type { BookingDTO } from '@ticket/shared';

// Shared booking-loading, mapping, and email helpers. Kept free of waitlist
// imports so both the bookings and waitlist modules can use them without a cycle.

export const bookingInclude = {
  seats: { include: { showSeat: { include: { venueSeat: true, seatCategory: true } } } },
  show: { include: { event: true, venue: true } },
  user: true,
} satisfies Prisma.BookingInclude;

export type FullBooking = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

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

/** Render the QR ticket and email it to the customer (QR inline + attached PNG). */
export async function sendTicketEmail(bookingId: string): Promise<void> {
  const b = await prisma.booking.findUnique({ where: { id: bookingId }, include: bookingInclude });
  if (!b) return;
  const [qrDataUrl, qrBuffer] = await Promise.all([
    generateQrDataUrl(b.qrToken),
    generateQrBuffer(b.qrToken),
  ]);
  const html = ticketEmailHtml({
    name: b.user.name,
    reference: b.reference,
    eventTitle: b.show.event.title,
    venueName: b.show.venue.name,
    startsAt: b.show.startsAt,
    seats: b.seats.map((s) => ({
      label: `${s.showSeat.venueSeat.rowLabel}${s.showSeat.venueSeat.colNumber}`,
      category: s.showSeat.seatCategory.name,
      price: toMoney(s.priceAtBooking),
    })),
    total: toMoney(b.totalAmount),
    qrDataUrl,
  });
  await sendMail({
    to: b.user.email,
    subject: `Your ticket — ${b.show.event.title} (${b.reference})`,
    html,
    attachments: [{ filename: `${b.reference}.png`, content: qrBuffer }],
  });
}

/** Map a show's per-category prices for quick lookup. */
export async function priceMap(
  tx: Prisma.TransactionClient,
  showId: string,
): Promise<Map<string, number>> {
  const pricing = await tx.showPricing.findMany({ where: { showId } });
  return new Map(pricing.map((p) => [p.seatCategoryId, toMoney(p.price)]));
}

/**
 * Retry a booking-creating transaction on the (rare) booking-reference unique
 * collision. The transaction rolls back fully on P2002, so a retry is safe.
 */
export async function withReferenceRetry<T>(fn: () => Promise<T>, max = 3): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && attempt < max) {
        attempt += 1;
        continue;
      }
      throw e;
    }
  }
}
