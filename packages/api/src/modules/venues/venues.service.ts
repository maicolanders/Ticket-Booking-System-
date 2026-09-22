import { prisma } from '../../lib/prisma';
import { badRequest, notFound, conflict } from '../../lib/errors';
import type { CreateVenueInput, CreateCategoryInput, GenerateSeatsInput } from '@ticket/shared';

export async function createVenue(input: CreateVenueInput) {
  return prisma.venue.create({ data: { name: input.name, address: input.address } });
}

export async function listVenues() {
  return prisma.venue.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      categories: { orderBy: { name: 'asc' } },
      _count: { select: { seats: true, shows: true } },
    },
  });
}

export async function getVenue(id: string) {
  const venue = await prisma.venue.findUnique({
    where: { id },
    include: {
      categories: { orderBy: { name: 'asc' } },
      seats: {
        orderBy: [{ gridRow: 'asc' }, { gridCol: 'asc' }],
        include: { category: true },
      },
    },
  });
  if (!venue) throw notFound('Venue not found');
  return venue;
}

export async function createCategory(venueId: string, input: CreateCategoryInput) {
  const venue = await prisma.venue.findUnique({ where: { id: venueId } });
  if (!venue) throw notFound('Venue not found');
  return prisma.seatCategory.create({
    data: { venueId, name: input.name, color: input.color },
  });
}

/**
 * Generate the venue's seat grid from an ordered list of sections. Each section
 * maps a set of row labels + seats-per-row to a seat category. Rows are laid out
 * top-to-bottom in the order given. Refuses to run once shows exist (seats are
 * snapshotted into shows and must not change underneath them).
 */
export async function generateSeats(venueId: string, input: GenerateSeatsInput) {
  const venue = await prisma.venue.findUnique({
    where: { id: venueId },
    include: { categories: true, _count: { select: { shows: true } } },
  });
  if (!venue) throw notFound('Venue not found');
  if (venue._count.shows > 0) {
    throw conflict('Cannot change the seat layout after shows have been scheduled for this venue');
  }

  const validCategoryIds = new Set(venue.categories.map((c) => c.id));
  const seats: {
    venueId: string;
    categoryId: string;
    rowLabel: string;
    colNumber: number;
    gridRow: number;
    gridCol: number;
  }[] = [];
  const seenRows = new Set<string>();
  let gridRow = 0;

  for (const section of input.sections) {
    if (!validCategoryIds.has(section.categoryId)) {
      throw badRequest(`Category ${section.categoryId} does not belong to this venue`);
    }
    for (const rowLabel of section.rowLabels) {
      if (seenRows.has(rowLabel)) throw badRequest(`Duplicate row label "${rowLabel}"`);
      seenRows.add(rowLabel);
      gridRow += 1;
      for (let seat = 1; seat <= section.seatsPerRow; seat += 1) {
        seats.push({
          venueId,
          categoryId: section.categoryId,
          rowLabel,
          colNumber: seat,
          gridRow,
          gridCol: seat,
        });
      }
    }
  }

  await prisma.$transaction([
    prisma.venueSeat.deleteMany({ where: { venueId } }),
    prisma.venueSeat.createMany({ data: seats }),
  ]);

  return getVenue(venueId);
}
