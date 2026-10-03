import { Prisma } from '@prisma/client';
import { prisma } from '../db/client';
import { toMinorUnits } from '../pricing/pricing';
import { ticketEmailHtml } from './emailTemplates';
import type { Mailer } from './mailer';
import { generateQrBuffer, generateQrDataUrl } from './qr';

/** Everything needed to render a booking, for DTOs and the ticket email. */
export const bookingInclude = {
  seats: { include: { showSeat: { include: { venueSeat: true, seatCategory: true } } } },
  show: { include: { event: true, venue: true } },
  user: true,
} satisfies Prisma.BookingInclude;

export type FullBooking = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

const major = (amount: Prisma.Decimal) => toMinorUnits(amount) / 100;

/**
 * Email the QR ticket for a booking, at most once per booking under normal
 * operation: a delivery is recorded in ticketEmailSentAt and repeats are skipped.
 * A crash between sending and recording can still resend (at-least-once), never lose it.
 */
export async function deliverTicket(bookingId: string, mailer: Mailer): Promise<'sent' | 'already_sent'> {
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: bookingInclude });
  if (booking.ticketEmailSentAt) return 'already_sent';

  const [qrDataUrl, qrBuffer] = await Promise.all([
    generateQrDataUrl(booking.qrToken),
    generateQrBuffer(booking.qrToken),
  ]);
  await mailer.send({
    to: booking.user.email,
    subject: `Your ticket — ${booking.show.event.title} (${booking.reference})`,
    html: ticketEmailHtml({
      name: booking.user.name,
      reference: booking.reference,
      eventTitle: booking.show.event.title,
      venueName: booking.show.venue.name,
      startsAt: booking.show.startsAt,
      seats: booking.seats.map((s) => ({
        label: `${s.showSeat.venueSeat.rowLabel}${s.showSeat.venueSeat.colNumber}`,
        category: s.showSeat.seatCategory.name,
        price: major(s.priceAtBooking),
      })),
      total: major(booking.totalAmount),
      qrDataUrl,
    }),
    attachments: [{ filename: `${booking.reference}.png`, content: qrBuffer }],
  });
  await prisma.booking.update({ where: { id: bookingId }, data: { ticketEmailSentAt: new Date() } });
  return 'sent';
}
