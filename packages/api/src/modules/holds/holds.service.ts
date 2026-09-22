import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { badRequest, notFound, forbidden, conflict } from '../../lib/errors';
import { toMoney } from '../../lib/money';
import { emitSeatUpdate } from '../../realtime/io';
import { SeatStatus, HoldStatus, SocketEvents, type HoldDTO } from '@ticket/shared';

interface LockedSeatRow {
  id: string;
  status: SeatStatus;
  holdId: string | null;
  showId: string;
}

/** Sum the price of a set of seats for a show, using per-category show pricing. */
async function computeSeatTotal(showId: string, seatIds: string[]): Promise<number> {
  const [seats, pricing] = await Promise.all([
    prisma.showSeat.findMany({ where: { id: { in: seatIds } }, select: { seatCategoryId: true } }),
    prisma.showPricing.findMany({ where: { showId } }),
  ]);
  const priceByCategory = new Map(pricing.map((p) => [p.seatCategoryId, toMoney(p.price)]));
  return seats.reduce((sum, s) => sum + (priceByCategory.get(s.seatCategoryId) ?? 0), 0);
}

/**
 * Place a hold on the requested seats.
 *
 * Concurrency: the target ShowSeat rows are locked with SELECT ... FOR UPDATE
 * inside a transaction, so two customers racing for the same seat are serialized
 * — the first commits HELD, the second sees HELD and gets a 409. Because each
 * physical seat is a single ShowSeat row, double-selling is structurally impossible.
 */
export async function createHold(userId: string, showId: string, seatIds: string[]): Promise<HoldDTO> {
  const uniqueSeatIds = [...new Set(seatIds)];

  const show = await prisma.show.findUnique({ where: { id: showId }, select: { id: true } });
  if (!show) throw notFound('Show not found');

  const expiresAt = new Date(Date.now() + env.HOLD_TTL_SECONDS * 1000);

  const hold = await prisma.$transaction(
    async (tx) => {
      // Pessimistic lock — serializes concurrent attempts on the same seats.
      const locked = await tx.$queryRaw<LockedSeatRow[]>(
        Prisma.sql`SELECT "id", "status", "holdId", "showId" FROM "ShowSeat" WHERE "id" IN (${Prisma.join(
          uniqueSeatIds,
        )}) FOR UPDATE`,
      );

      if (locked.length !== uniqueSeatIds.length) throw badRequest('One or more seats do not exist');
      if (locked.some((s) => s.showId !== showId)) throw badRequest('Seats do not belong to this show');

      // Lazy-expire stale checkout holds on these seats (backstop for the sweeper).
      const heldWithHold = locked.filter((s) => s.status === SeatStatus.HELD && s.holdId);
      if (heldWithHold.length > 0) {
        const holdIds = [...new Set(heldWithHold.map((s) => s.holdId!))];
        const expiredHolds = await tx.hold.findMany({
          where: { id: { in: holdIds }, status: HoldStatus.ACTIVE, expiresAt: { lt: new Date() } },
          select: { id: true },
        });
        const expiredIds = new Set(expiredHolds.map((h) => h.id));
        if (expiredIds.size > 0) {
          await tx.showSeat.updateMany({
            where: { holdId: { in: [...expiredIds] } },
            data: { status: SeatStatus.AVAILABLE, holdId: null },
          });
          await tx.hold.updateMany({
            where: { id: { in: [...expiredIds] } },
            data: { status: HoldStatus.EXPIRED },
          });
          for (const s of locked) {
            if (s.holdId && expiredIds.has(s.holdId)) {
              s.status = SeatStatus.AVAILABLE;
              s.holdId = null;
            }
          }
        }
      }

      const unavailable = locked.filter((s) => s.status !== SeatStatus.AVAILABLE);
      if (unavailable.length > 0) {
        throw conflict('Some of the selected seats are no longer available', {
          seatIds: unavailable.map((s) => s.id),
        });
      }

      const created = await tx.hold.create({ data: { showId, userId, expiresAt } });
      await tx.showSeat.updateMany({
        where: { id: { in: uniqueSeatIds } },
        data: { status: SeatStatus.HELD, holdId: created.id },
      });
      return created;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000, maxWait: 5000 },
  );

  emitSeatUpdate(SocketEvents.SEAT_HELD, showId, uniqueSeatIds, SeatStatus.HELD);

  const totalAmount = await computeSeatTotal(showId, uniqueSeatIds);
  return {
    id: hold.id,
    showId,
    seatIds: uniqueSeatIds,
    expiresAt: hold.expiresAt.toISOString(),
    totalAmount,
  };
}

/** Release a hold early (checkout abandoned). Idempotent for non-active holds. */
export async function releaseHold(userId: string, holdId: string): Promise<void> {
  const hold = await prisma.hold.findUnique({
    where: { id: holdId },
    include: { seats: { select: { id: true } } },
  });
  if (!hold) throw notFound('Hold not found');
  if (hold.userId !== userId) throw forbidden('This hold does not belong to you');
  if (hold.status !== HoldStatus.ACTIVE) return;

  const seatIds = hold.seats.map((s) => s.id);
  await prisma.$transaction([
    prisma.showSeat.updateMany({
      where: { holdId },
      data: { status: SeatStatus.AVAILABLE, holdId: null },
    }),
    prisma.hold.update({ where: { id: holdId }, data: { status: HoldStatus.RELEASED } }),
  ]);

  emitSeatUpdate(SocketEvents.SEAT_RELEASED, hold.showId, seatIds, SeatStatus.AVAILABLE);
}

/**
 * Release all expired active holds (optionally scoped to one show). Used by the
 * background sweeper and as a lazy backstop when reading a seat map.
 * Returns the number of holds released.
 */
export async function releaseExpiredHolds(showId?: string): Promise<number> {
  const expired = await prisma.hold.findMany({
    where: {
      status: HoldStatus.ACTIVE,
      expiresAt: { lt: new Date() },
      ...(showId ? { showId } : {}),
    },
    include: { seats: { select: { id: true } } },
  });

  for (const hold of expired) {
    const seatIds = hold.seats.map((s) => s.id);
    await prisma.$transaction([
      prisma.showSeat.updateMany({
        where: { holdId: hold.id },
        data: { status: SeatStatus.AVAILABLE, holdId: null },
      }),
      prisma.hold.update({ where: { id: hold.id }, data: { status: HoldStatus.EXPIRED } }),
    ]);
    if (seatIds.length > 0) {
      emitSeatUpdate(SocketEvents.SEAT_RELEASED, hold.showId, seatIds, SeatStatus.AVAILABLE);
    }
  }

  return expired.length;
}
