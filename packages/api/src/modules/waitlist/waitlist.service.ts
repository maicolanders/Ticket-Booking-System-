import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { badRequest, notFound, forbidden, conflict, gone } from '../../lib/errors';
import { offerToken, bookingReference } from '../../lib/ids';
import { signTicketToken } from '../../lib/jwt';
import { sendMail } from '../../lib/mailer';
import { waitlistOfferEmailHtml } from '../../lib/emailTemplates';
import { emitSeatUpdate } from '../../realtime/io';
import {
  SeatStatus,
  BookingStatus,
  WaitlistStatus,
  OfferStatus,
  SocketEvents,
  type WaitlistEntryDTO,
  type WaitlistOfferDTO,
  type BookingDTO,
} from '@ticket/shared';
import {
  priceMap,
  sendTicketEmail,
  getBookingDetail,
  withReferenceRetry,
} from '../bookings/bookings.shared';

const seatLabel = (rowLabel: string, colNumber: number) => `${rowLabel}${colNumber}`;

/* ============================================================================
 * Customer-facing waitlist actions
 * ==========================================================================*/

/** Join the waitlist for a sold-out seat category on a show (FIFO by createdAt). */
export async function joinWaitlist(
  userId: string,
  showId: string,
  seatCategoryId: string,
): Promise<WaitlistEntryDTO> {
  const pricing = await prisma.showPricing.findUnique({
    where: { showId_seatCategoryId: { showId, seatCategoryId } },
    include: { seatCategory: true },
  });
  if (!pricing) throw badRequest('That seat category is not part of this show');

  const existing = await prisma.waitlistEntry.findFirst({
    where: {
      showId,
      seatCategoryId,
      userId,
      status: { in: [WaitlistStatus.WAITING, WaitlistStatus.OFFERED] },
    },
  });
  if (existing) throw conflict('You are already on the waitlist for this category');

  const entry = await prisma.waitlistEntry.create({
    data: { showId, seatCategoryId, userId, status: WaitlistStatus.WAITING },
  });

  const position = await waitlistPosition(showId, seatCategoryId, entry.createdAt);
  return {
    id: entry.id,
    showId,
    seatCategoryId,
    categoryName: pricing.seatCategory.name,
    status: entry.status,
    position,
    createdAt: entry.createdAt.toISOString(),
    offer: null,
  };
}

/** The requester's active waitlist entries for a show (with positions + any live offer). */
export async function getMyWaitlist(userId: string, showId: string): Promise<WaitlistEntryDTO[]> {
  const entries = await prisma.waitlistEntry.findMany({
    where: {
      showId,
      userId,
      status: { in: [WaitlistStatus.WAITING, WaitlistStatus.OFFERED] },
    },
    orderBy: { createdAt: 'asc' },
    include: {
      seatCategory: { select: { name: true } },
      offers: {
        where: { status: OfferStatus.PENDING },
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: { showSeat: { include: { venueSeat: true } } },
      },
    },
  });

  return Promise.all(
    entries.map(async (e) => {
      const liveOffer = e.offers[0];
      return {
        id: e.id,
        showId: e.showId,
        seatCategoryId: e.seatCategoryId,
        categoryName: e.seatCategory.name,
        status: e.status,
        position:
          e.status === WaitlistStatus.WAITING
            ? await waitlistPosition(e.showId, e.seatCategoryId, e.createdAt)
            : null,
        createdAt: e.createdAt.toISOString(),
        offer: liveOffer
          ? {
              token: liveOffer.offerToken,
              expiresAt: liveOffer.expiresAt.toISOString(),
              seatLabel: seatLabel(liveOffer.showSeat.venueSeat.rowLabel, liveOffer.showSeat.venueSeat.colNumber),
            }
          : null,
      };
    }),
  );
}

/** Leave the waitlist (only WAITING entries — an active offer must be used or expire). */
export async function leaveWaitlist(userId: string, entryId: string): Promise<void> {
  const entry = await prisma.waitlistEntry.findUnique({ where: { id: entryId } });
  if (!entry) throw notFound('Waitlist entry not found');
  if (entry.userId !== userId) throw forbidden('This waitlist entry does not belong to you');
  if (entry.status === WaitlistStatus.OFFERED) {
    throw conflict('You have a pending seat offer — use it or let it expire first');
  }
  if (entry.status !== WaitlistStatus.WAITING) return;
  await prisma.waitlistEntry.update({
    where: { id: entryId },
    data: { status: WaitlistStatus.CANCELLED },
  });
}

/** 1-based position of an entry among the WAITING entries for its show + category. */
async function waitlistPosition(
  showId: string,
  seatCategoryId: string,
  createdAt: Date,
): Promise<number> {
  const ahead = await prisma.waitlistEntry.count({
    where: {
      showId,
      seatCategoryId,
      status: WaitlistStatus.WAITING,
      createdAt: { lt: createdAt },
    },
  });
  return ahead + 1;
}

/* ============================================================================
 * Offer details + acceptance
 * ==========================================================================*/

/** Fetch a pending offer's details for the completion page (owner-authorized). */
export async function getOffer(userId: string, token: string): Promise<WaitlistOfferDTO> {
  const offer = await prisma.waitlistOffer.findUnique({
    where: { offerToken: token },
    include: {
      waitlistEntry: { include: { seatCategory: true } },
      showSeat: {
        include: {
          venueSeat: true,
          show: { include: { event: true, venue: true } },
        },
      },
    },
  });
  if (!offer) throw notFound('Offer not found');
  if (offer.waitlistEntry.userId !== userId) throw forbidden('This offer does not belong to you');

  const show = offer.showSeat.show;
  return {
    token: offer.offerToken,
    status: offer.status,
    expiresAt: offer.expiresAt.toISOString(),
    showId: show.id,
    seatLabel: seatLabel(offer.showSeat.venueSeat.rowLabel, offer.showSeat.venueSeat.colNumber),
    categoryName: offer.waitlistEntry.seatCategory.name,
    eventTitle: show.event.title,
    venueName: show.venue.name,
    startsAt: show.startsAt.toISOString(),
  };
}

interface OfferedSeatRow {
  id: string;
  status: SeatStatus;
  seatCategoryId: string;
}

/** Accept a time-limited offer → confirm a booking for the offered seat + email QR. */
export async function acceptOffer(userId: string, token: string): Promise<BookingDTO> {
  const { bookingId, showId, showSeatId } = await withReferenceRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const offer = await tx.waitlistOffer.findUnique({
          where: { offerToken: token },
          include: { waitlistEntry: true },
        });
        if (!offer) throw notFound('Offer not found');
        if (offer.waitlistEntry.userId !== userId) throw forbidden('This offer does not belong to you');
        if (offer.status !== OfferStatus.PENDING) throw conflict('This offer is no longer available');
        if (offer.expiresAt.getTime() <= Date.now()) throw gone('This offer has expired');

        // Lock the offered seat — guards against the sweeper expiring it concurrently.
        const locked = await tx.$queryRaw<OfferedSeatRow[]>(
          Prisma.sql`SELECT "id", "status", "seatCategoryId" FROM "ShowSeat" WHERE "id" = ${offer.showSeatId} FOR UPDATE`,
        );
        const seat = locked[0];
        if (!seat || seat.status !== SeatStatus.HELD) {
          throw gone('The offered seat is no longer available');
        }

        const prices = await priceMap(tx, offer.waitlistEntry.showId);
        const price = prices.get(seat.seatCategoryId) ?? 0;
        const reference = bookingReference();
        const booking = await tx.booking.create({
          data: {
            reference,
            showId: offer.waitlistEntry.showId,
            userId,
            status: BookingStatus.CONFIRMED,
            totalAmount: price,
            qrToken: signTicketToken(reference),
            seats: { create: [{ showSeatId: offer.showSeatId, priceAtBooking: price }] },
          },
        });
        await tx.showSeat.update({
          where: { id: offer.showSeatId },
          data: { status: SeatStatus.BOOKED, holdId: null },
        });
        await tx.waitlistOffer.update({ where: { id: offer.id }, data: { status: OfferStatus.ACCEPTED } });
        await tx.waitlistEntry.update({
          where: { id: offer.waitlistEntryId },
          data: { status: WaitlistStatus.CONVERTED },
        });

        return { bookingId: booking.id, showId: offer.waitlistEntry.showId, showSeatId: offer.showSeatId };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000, maxWait: 5000 },
    ),
  );

  emitSeatUpdate(SocketEvents.SEAT_BOOKED, showId, [showSeatId], SeatStatus.BOOKED);
  await sendTicketEmail(bookingId);
  return getBookingDetail(bookingId, userId);
}

/* ============================================================================
 * Seat → waitlist assignment (called on cancellation and on offer expiry)
 * ==========================================================================*/

interface OfferResult {
  outcome: 'offered' | 'released' | 'taken';
}

/**
 * Offer a single freed seat to the next WAITING customer for its category (FIFO).
 * Runs in a locked transaction; on success the seat becomes HELD (reserved for the
 * offeree) and a time-limited offer + email is issued. If nobody is waiting the seat
 * is released (AVAILABLE). Emits the matching realtime event.
 */
async function offerSeatToNextInLine(showId: string, showSeatId: string): Promise<OfferResult> {
  const result = await prisma.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<OfferedSeatRow[]>(
        Prisma.sql`SELECT "id", "status", "seatCategoryId" FROM "ShowSeat" WHERE "id" = ${showSeatId} FOR UPDATE`,
      );
      const seat = locked[0];
      // Someone grabbed the seat in the race window — leave it be.
      if (!seat || seat.status !== SeatStatus.AVAILABLE) return { outcome: 'taken' as const };

      // Next waiting entry for this category, FIFO. SKIP LOCKED avoids two
      // concurrent offer flows handing the same entry two seats.
      const candidates = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT "id" FROM "WaitlistEntry"
                   WHERE "showId" = ${showId}
                     AND "seatCategoryId" = ${seat.seatCategoryId}
                     AND "status" = 'WAITING'
                   ORDER BY "createdAt" ASC
                   FOR UPDATE SKIP LOCKED
                   LIMIT 1`,
      );
      if (candidates.length === 0) {
        // Nobody waiting → the seat is genuinely free again.
        await tx.showSeat.update({
          where: { id: showSeatId },
          data: { status: SeatStatus.AVAILABLE, holdId: null },
        });
        return { outcome: 'released' as const };
      }

      const entryId = candidates[0].id;
      const token = offerToken();
      const expiresAt = new Date(Date.now() + env.WAITLIST_OFFER_TTL_SECONDS * 1000);
      await tx.waitlistOffer.create({
        data: {
          waitlistEntryId: entryId,
          showSeatId,
          offerToken: token,
          status: OfferStatus.PENDING,
          expiresAt,
        },
      });
      await tx.waitlistEntry.update({ where: { id: entryId }, data: { status: WaitlistStatus.OFFERED } });
      // Reserve the seat for the offeree (HELD, but not tied to a checkout Hold).
      await tx.showSeat.update({
        where: { id: showSeatId },
        data: { status: SeatStatus.HELD, holdId: null },
      });

      const details = await tx.waitlistEntry.findUnique({
        where: { id: entryId },
        include: {
          user: { select: { name: true, email: true } },
          seatCategory: { select: { name: true } },
          show: { include: { event: { select: { title: true } } } },
        },
      });
      const seatRow = await tx.showSeat.findUnique({
        where: { id: showSeatId },
        include: { venueSeat: true },
      });

      return {
        outcome: 'offered' as const,
        token,
        expiresAt,
        email: details!.user.email,
        name: details!.user.name,
        eventTitle: details!.show.event.title,
        categoryName: details!.seatCategory.name,
        seatLabel: seatLabel(seatRow!.venueSeat.rowLabel, seatRow!.venueSeat.colNumber),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000, maxWait: 5000 },
  );

  if (result.outcome === 'offered') {
    const offerUrl = `${env.APP_BASE_URL}/waitlist/offer/${result.token}`;
    await sendMail({
      to: result.email,
      subject: `A seat opened up for ${result.eventTitle}`,
      html: waitlistOfferEmailHtml({
        name: result.name,
        eventTitle: result.eventTitle,
        categoryName: result.categoryName,
        seatLabel: result.seatLabel,
        offerUrl,
        expiresAt: result.expiresAt,
      }),
    });
    emitSeatUpdate(SocketEvents.SEAT_OFFERED, showId, [showSeatId], SeatStatus.HELD);
  } else if (result.outcome === 'released') {
    emitSeatUpdate(SocketEvents.SEAT_RELEASED, showId, [showSeatId], SeatStatus.AVAILABLE);
  }
  return { outcome: result.outcome };
}

/** Offer a batch of freed seats to the waitlist, one at a time (preserves FIFO). */
export async function offerSeatsToWaitlist(showId: string, showSeatIds: string[]): Promise<void> {
  for (const seatId of showSeatIds) {
    await offerSeatToNextInLine(showId, seatId);
  }
}

/**
 * Expire stale PENDING offers (called by the sweeper). Each expired offer frees
 * its seat and re-offers it to the next person in line, or releases it if none.
 * The offeree who let the offer lapse is dropped (status EXPIRED).
 * Returns the number of offers expired.
 */
export async function processExpiredOffers(): Promise<number> {
  const expired = await prisma.waitlistOffer.findMany({
    where: { status: OfferStatus.PENDING, expiresAt: { lt: new Date() } },
    include: { showSeat: { select: { id: true, showId: true } } },
  });

  for (const offer of expired) {
    await prisma.$transaction(
      async (tx) => {
        // Re-check under nothing-fancy: skip if it was accepted meanwhile.
        const fresh = await tx.waitlistOffer.findUnique({ where: { id: offer.id } });
        if (!fresh || fresh.status !== OfferStatus.PENDING) return;
        await tx.waitlistOffer.update({ where: { id: offer.id }, data: { status: OfferStatus.EXPIRED } });
        await tx.waitlistEntry.update({
          where: { id: offer.waitlistEntryId },
          data: { status: WaitlistStatus.EXPIRED },
        });
        // Free the seat it was holding (only if still HELD by this offer).
        await tx.showSeat.updateMany({
          where: { id: offer.showSeatId, status: SeatStatus.HELD },
          data: { status: SeatStatus.AVAILABLE, holdId: null },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    // Re-offer to the next in line (or release + emit).
    await offerSeatToNextInLine(offer.showSeat.showId, offer.showSeatId);
  }

  return expired.length;
}
