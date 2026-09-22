import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { notFound } from '../../lib/errors';
import { toMoney } from '../../lib/money';
import type { CreateEventInput, EventFilterInput } from '@ticket/shared';

export async function createEvent(organiserId: string, input: CreateEventInput) {
  return prisma.event.create({
    data: {
      organiserId,
      title: input.title,
      description: input.description,
      type: input.type,
      imageUrl: input.imageUrl,
      genre: input.genre,
    },
  });
}

/** Count AVAILABLE seats per show in one query, keyed by showId. */
async function availabilityByShow(showIds: string[]) {
  if (showIds.length === 0) return new Map<string, { total: number; available: number }>();
  const grouped = await prisma.showSeat.groupBy({
    by: ['showId', 'status'],
    where: { showId: { in: showIds } },
    _count: { _all: true },
  });
  const map = new Map<string, { total: number; available: number }>();
  for (const id of showIds) map.set(id, { total: 0, available: 0 });
  for (const row of grouped) {
    const entry = map.get(row.showId)!;
    entry.total += row._count._all;
    if (row.status === 'AVAILABLE') entry.available += row._count._all;
  }
  return map;
}

export async function listEvents(filter: EventFilterInput) {
  const where: Prisma.EventWhereInput = {};
  if (filter.type) where.type = filter.type;
  if (filter.search) where.title = { contains: filter.search, mode: 'insensitive' };

  const showWhere: Prisma.ShowWhereInput = {};
  if (filter.venueId) showWhere.venueId = filter.venueId;
  if (filter.date) {
    const start = new Date(`${filter.date}T00:00:00.000Z`);
    const end = new Date(`${filter.date}T23:59:59.999Z`);
    showWhere.startsAt = { gte: start, lte: end };
  }
  if (Object.keys(showWhere).length > 0) where.shows = { some: showWhere };

  const events = await prisma.event.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      organiser: { select: { id: true, name: true } },
      shows: {
        orderBy: { startsAt: 'asc' },
        include: { venue: { select: { id: true, name: true } }, pricing: true },
      },
    },
  });

  return events.map((event) => {
    const prices = event.shows.flatMap((s) => s.pricing.map((p) => toMoney(p.price)));
    return {
      id: event.id,
      title: event.title,
      description: event.description,
      type: event.type,
      imageUrl: event.imageUrl,
      genre: event.genre,
      organiserName: event.organiser.name,
      showCount: event.shows.length,
      nextShowAt: event.shows[0]?.startsAt ?? null,
      minPrice: prices.length ? Math.min(...prices) : null,
      maxPrice: prices.length ? Math.max(...prices) : null,
    };
  });
}

export async function getEvent(id: string) {
  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      organiser: { select: { id: true, name: true } },
      shows: {
        orderBy: { startsAt: 'asc' },
        include: {
          venue: { select: { id: true, name: true, address: true } },
          pricing: { include: { seatCategory: true } },
        },
      },
    },
  });
  if (!event) throw notFound('Event not found');

  const availability = await availabilityByShow(event.shows.map((s) => s.id));

  return {
    id: event.id,
    title: event.title,
    description: event.description,
    type: event.type,
    imageUrl: event.imageUrl,
    genre: event.genre,
    organiser: event.organiser,
    shows: event.shows.map((show) => {
      const avail = availability.get(show.id) ?? { total: 0, available: 0 };
      return {
        id: show.id,
        startsAt: show.startsAt,
        endsAt: show.endsAt,
        venue: show.venue,
        pricing: show.pricing.map((p) => ({
          seatCategoryId: p.seatCategoryId,
          name: p.seatCategory.name,
          color: p.seatCategory.color,
          price: toMoney(p.price),
        })),
        totalSeats: avail.total,
        availableSeats: avail.available,
        soldOut: avail.total > 0 && avail.available === 0,
      };
    }),
  };
}

/** Events created by a given organiser (for their dashboard). */
export async function listOrganiserEvents(organiserId: string) {
  const events = await prisma.event.findMany({
    where: { organiserId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { shows: true } } },
  });
  return events.map((e) => ({
    id: e.id,
    title: e.title,
    type: e.type,
    genre: e.genre,
    imageUrl: e.imageUrl,
    showCount: e._count.shows,
  }));
}
