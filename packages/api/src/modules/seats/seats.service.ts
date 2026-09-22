import { prisma } from '../../lib/prisma';
import { notFound } from '../../lib/errors';
import { toMoney } from '../../lib/money';
import { releaseExpiredHolds } from '../holds/holds.service';
import {
  SeatStatus,
  type SeatMapDTO,
  type SeatMapSeatDTO,
  type SeatCategorySummaryDTO,
} from '@ticket/shared';

/** Build the full per-show seat map: grid geometry, per-seat status, category summaries. */
export async function getSeatMap(showId: string, userId?: string): Promise<SeatMapDTO> {
  const show = await prisma.show.findUnique({ where: { id: showId }, select: { id: true } });
  if (!show) throw notFound('Show not found');

  // Backstop: free any seats whose checkout hold expired since the last sweep.
  await releaseExpiredHolds(showId);

  const [seats, pricing] = await Promise.all([
    prisma.showSeat.findMany({
      where: { showId },
      include: {
        venueSeat: true,
        seatCategory: true,
        hold: { select: { userId: true } },
      },
      orderBy: [{ venueSeat: { gridRow: 'asc' } }, { venueSeat: { gridCol: 'asc' } }],
    }),
    prisma.showPricing.findMany({ where: { showId } }),
  ]);

  const priceByCategory = new Map(pricing.map((p) => [p.seatCategoryId, toMoney(p.price)]));
  const categoryMap = new Map<string, SeatCategorySummaryDTO>();
  let gridRows = 0;
  let gridCols = 0;

  const seatDtos: SeatMapSeatDTO[] = seats.map((s) => {
    gridRows = Math.max(gridRows, s.venueSeat.gridRow);
    gridCols = Math.max(gridCols, s.venueSeat.gridCol);
    const price = priceByCategory.get(s.seatCategoryId) ?? 0;

    let summary = categoryMap.get(s.seatCategoryId);
    if (!summary) {
      summary = {
        id: s.seatCategoryId,
        name: s.seatCategory.name,
        color: s.seatCategory.color,
        price,
        total: 0,
        available: 0,
      };
      categoryMap.set(s.seatCategoryId, summary);
    }
    summary.total += 1;
    if (s.status === SeatStatus.AVAILABLE) summary.available += 1;

    return {
      id: s.id,
      rowLabel: s.venueSeat.rowLabel,
      colNumber: s.venueSeat.colNumber,
      gridRow: s.venueSeat.gridRow,
      gridCol: s.venueSeat.gridCol,
      status: s.status as SeatStatus,
      categoryId: s.seatCategoryId,
      categoryName: s.seatCategory.name,
      categoryColor: s.seatCategory.color,
      price,
      heldByMe: Boolean(userId && s.status === SeatStatus.HELD && s.hold?.userId === userId),
    };
  });

  const categories = [...categoryMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  const soldOutCategoryIds = categories.filter((c) => c.available === 0).map((c) => c.id);

  return { showId, gridRows, gridCols, soldOutCategoryIds, categories, seats: seatDtos };
}
