import { prisma } from '../../lib/prisma';
import { badRequest, notFound, forbidden } from '../../lib/errors';
import { toMoney } from '../../lib/money';
import { SeatStatus, type CreateShowInput } from '@ticket/shared';

/**
 * Create a show for an event: validates ownership + pricing, then snapshots the
 * venue's seat layout into per-show ShowSeat rows (all AVAILABLE) in one transaction.
 */
export async function createShow(organiserId: string, eventId: string, input: CreateShowInput) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw notFound('Event not found');
  if (event.organiserId !== organiserId) throw forbidden('You can only add shows to your own events');

  const venue = await prisma.venue.findUnique({
    where: { id: input.venueId },
    include: { seats: true, categories: true },
  });
  if (!venue) throw notFound('Venue not found');
  if (venue.seats.length === 0) throw badRequest('This venue has no seat layout yet');

  const venueCategoryIds = new Set(venue.categories.map((c) => c.id));
  const usedCategoryIds = new Set(venue.seats.map((s) => s.categoryId));
  const pricedIds = new Set(input.pricing.map((p) => p.seatCategoryId));

  for (const p of input.pricing) {
    if (!venueCategoryIds.has(p.seatCategoryId)) {
      throw badRequest('Pricing references a category that does not belong to this venue');
    }
  }
  for (const catId of usedCategoryIds) {
    if (!pricedIds.has(catId)) {
      throw badRequest('Pricing is required for every seat category used in this venue');
    }
  }

  return prisma.$transaction(async (tx) => {
    const show = await tx.show.create({
      data: {
        eventId,
        venueId: input.venueId,
        startsAt: new Date(input.startsAt),
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
      },
    });
    await tx.showPricing.createMany({
      data: input.pricing.map((p) => ({
        showId: show.id,
        seatCategoryId: p.seatCategoryId,
        price: p.price,
      })),
    });
    await tx.showSeat.createMany({
      data: venue.seats.map((vs) => ({
        showId: show.id,
        venueSeatId: vs.id,
        seatCategoryId: vs.categoryId,
        status: SeatStatus.AVAILABLE,
      })),
    });
    return show;
  });
}

export async function getShow(id: string) {
  const show = await prisma.show.findUnique({
    where: { id },
    include: {
      event: { include: { organiser: { select: { id: true, name: true } } } },
      venue: { select: { id: true, name: true, address: true } },
      pricing: { include: { seatCategory: true } },
    },
  });
  if (!show) throw notFound('Show not found');

  return {
    id: show.id,
    startsAt: show.startsAt,
    endsAt: show.endsAt,
    event: {
      id: show.event.id,
      title: show.event.title,
      description: show.event.description,
      type: show.event.type,
      imageUrl: show.event.imageUrl,
      genre: show.event.genre,
      organiser: show.event.organiser,
    },
    venue: show.venue,
    pricing: show.pricing.map((p) => ({
      seatCategoryId: p.seatCategoryId,
      name: p.seatCategory.name,
      color: p.seatCategory.color,
      price: toMoney(p.price),
    })),
  };
}
