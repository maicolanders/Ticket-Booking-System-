import { prisma } from '../../lib/prisma';
import { notFound, forbidden } from '../../lib/errors';
import { toMoney } from '../../lib/money';
import {
  BookingStatus,
  WaitlistStatus,
  type EventSummaryDTO,
  type ShowReportDTO,
  type CategoryReportDTO,
} from '@ticket/shared';

/**
 * Booking + revenue summary for one of the organiser's events, broken down per
 * show and per seat category (capacity, sold, revenue, and current waitlist demand).
 */
export async function getEventSummary(organiserId: string, eventId: string): Promise<EventSummaryDTO> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      shows: {
        orderBy: { startsAt: 'asc' },
        include: {
          venue: { select: { name: true } },
          pricing: { include: { seatCategory: true } },
        },
      },
    },
  });
  if (!event) throw notFound('Event not found');
  if (event.organiserId !== organiserId) throw forbidden('You can only view summaries for your own events');

  const showIds = event.shows.map((s) => s.id);

  // Capacity per (show, category); confirmed sales + revenue per (show, category); waitlist demand.
  const [seatGroups, bookingSeats, waitGroups] = await Promise.all([
    showIds.length
      ? prisma.showSeat.groupBy({
          by: ['showId', 'seatCategoryId'],
          where: { showId: { in: showIds } },
          _count: { _all: true },
        })
      : [],
    showIds.length
      ? prisma.bookingSeat.findMany({
          where: { booking: { showId: { in: showIds }, status: BookingStatus.CONFIRMED } },
          select: {
            priceAtBooking: true,
            booking: { select: { showId: true } },
            showSeat: { select: { seatCategoryId: true } },
          },
        })
      : [],
    showIds.length
      ? prisma.waitlistEntry.groupBy({
          by: ['showId', 'seatCategoryId'],
          where: { showId: { in: showIds }, status: WaitlistStatus.WAITING },
          _count: { _all: true },
        })
      : [],
  ]);

  const key = (showId: string, catId: string) => `${showId}:${catId}`;
  const capacityByKey = new Map<string, number>();
  for (const g of seatGroups) capacityByKey.set(key(g.showId, g.seatCategoryId), g._count._all);
  const waitingByKey = new Map<string, number>();
  for (const g of waitGroups) waitingByKey.set(key(g.showId, g.seatCategoryId), g._count._all);

  const soldByKey = new Map<string, { booked: number; revenue: number }>();
  for (const bs of bookingSeats) {
    const k = key(bs.booking.showId, bs.showSeat.seatCategoryId);
    const entry = soldByKey.get(k) ?? { booked: 0, revenue: 0 };
    entry.booked += 1;
    entry.revenue += toMoney(bs.priceAtBooking);
    soldByKey.set(k, entry);
  }

  let totalRevenue = 0;
  let totalBooked = 0;
  let totalCapacity = 0;

  const shows: ShowReportDTO[] = event.shows.map((show) => {
    let showCapacity = 0;
    let showBooked = 0;
    let showRevenue = 0;

    const categories: CategoryReportDTO[] = show.pricing.map((p) => {
      const k = key(show.id, p.seatCategoryId);
      const capacity = capacityByKey.get(k) ?? 0;
      const sold = soldByKey.get(k) ?? { booked: 0, revenue: 0 };
      showCapacity += capacity;
      showBooked += sold.booked;
      showRevenue += sold.revenue;
      return {
        seatCategoryId: p.seatCategoryId,
        name: p.seatCategory.name,
        color: p.seatCategory.color,
        price: toMoney(p.price),
        capacity,
        booked: sold.booked,
        available: Math.max(0, capacity - sold.booked),
        revenue: sold.revenue,
        waiting: waitingByKey.get(k) ?? 0,
      };
    });

    totalCapacity += showCapacity;
    totalBooked += showBooked;
    totalRevenue += showRevenue;

    return {
      showId: show.id,
      startsAt: show.startsAt.toISOString(),
      venueName: show.venue.name,
      capacity: showCapacity,
      booked: showBooked,
      revenue: showRevenue,
      categories,
    };
  });

  return {
    eventId: event.id,
    title: event.title,
    totalRevenue,
    totalBooked,
    totalCapacity,
    shows,
  };
}
