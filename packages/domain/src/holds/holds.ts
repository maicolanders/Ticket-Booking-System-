import { HoldStatus, SeatStatus } from '@ticket/shared';
import { prisma } from '../db/client';
import { runInTransaction, type Tx } from '../db/transaction';
import { DomainError } from '../errors';
import { quoteSeats, type SeatQuote } from '../pricing/pricing';
import { holdSeats, lockSeats, releaseHeldSeats } from '../seats/seats';

export interface PlacedHold {
  holdId: string;
  showId: string;
  seatIds: string[];
  expiresAt: Date;
  quote: SeatQuote;
}

export interface ReleasedHold {
  holdId: string;
  showId: string;
  seatIds: string[];
}

type HoldEnd = typeof HoldStatus.RELEASED | typeof HoldStatus.EXPIRED;

/** A hold protects its seats only while ACTIVE and unexpired. */
export const isHoldActive = (hold: { status: string; expiresAt: Date }, now = new Date()): boolean =>
  hold.status === HoldStatus.ACTIVE && hold.expiresAt.getTime() > now.getTime();

/**
 * Inside the caller's transaction, expire ACTIVE holds that have lapsed and still
 * own some of `seatIds`. Correctness never depends on the sweeper's timing.
 */
async function expireLapsedHolds(tx: Tx, holdIds: string[]): Promise<void> {
  if (holdIds.length === 0) return;
  const lapsed = await tx.hold.findMany({
    where: { id: { in: holdIds }, status: HoldStatus.ACTIVE, expiresAt: { lte: new Date() } },
    select: { id: true },
  });
  for (const { id } of lapsed) {
    await tx.hold.update({ where: { id }, data: { status: HoldStatus.EXPIRED } });
    await releaseHeldSeats(tx, id);
  }
}

/**
 * Hold `seatIds` for `ttlSeconds`, all or nothing. Concurrent requests for the
 * same seat serialise on the row locks: the first commits HELD, the rest see
 * HELD and get a `conflict`.
 */
export async function placeHold(input: {
  userId: string;
  showId: string;
  seatIds: string[];
  ttlSeconds: number;
}): Promise<PlacedHold> {
  const seatIds = [...new Set(input.seatIds)];
  if (seatIds.length === 0) throw new DomainError('invalid', 'Select at least one seat');

  const show = await prisma.show.findUnique({ where: { id: input.showId }, select: { id: true } });
  if (!show) throw new DomainError('not_found', 'Show not found');

  const hold = await runInTransaction(async (tx) => {
    const locked = await lockSeats(tx, seatIds);
    if (locked.length !== seatIds.length) throw new DomainError('invalid', 'One or more seats do not exist');
    if (locked.some((seat) => seat.showId !== input.showId)) {
      throw new DomainError('invalid', 'Seats do not belong to this show');
    }

    const heldBy = locked.flatMap((seat) => (seat.status === SeatStatus.HELD && seat.holdId ? [seat.holdId] : []));
    await expireLapsedHolds(tx, [...new Set(heldBy)]);

    const current = await tx.showSeat.findMany({
      where: { id: { in: seatIds }, status: { not: SeatStatus.AVAILABLE } },
      select: { id: true },
    });
    if (current.length > 0) {
      throw new DomainError('conflict', 'Some of the selected seats are no longer available', {
        seatIds: current.map((seat) => seat.id),
      });
    }

    const created = await tx.hold.create({
      data: {
        showId: input.showId,
        userId: input.userId,
        expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
      },
    });
    await holdSeats(tx, seatIds, created.id);
    return created;
  });

  const quote = await quoteSeats(prisma, input.showId, seatIds);
  return { holdId: hold.id, showId: input.showId, seatIds, expiresAt: hold.expiresAt, quote };
}

/**
 * End an ACTIVE hold and free its seats. Idempotent and race-safe: only the
 * caller that flips the hold out of ACTIVE releases the seats; everyone else
 * (a repeat call, the sweeper, a hold already converted to a booking) gets null.
 */
export function releaseHold(holdId: string, outcome: HoldEnd): Promise<ReleasedHold | null> {
  return runInTransaction(async (tx) => {
    const hold = await tx.hold.findUnique({
      where: { id: holdId },
      select: { showId: true, seats: { select: { id: true } } },
    });
    if (!hold) return null;

    // Seats before the hold row: the same order placeHold uses, so the two never deadlock.
    const locked = await lockSeats(
      tx,
      hold.seats.map((seat) => seat.id),
    );
    const { count } = await tx.hold.updateMany({
      where: { id: holdId, status: HoldStatus.ACTIVE },
      data: { status: outcome },
    });
    if (count === 0) return null;

    await releaseHeldSeats(tx, holdId);
    return {
      holdId,
      showId: hold.showId,
      seatIds: locked.filter((seat) => seat.holdId === holdId).map((seat) => seat.id),
    };
  });
}

/** Expire every lapsed ACTIVE hold, optionally for one show. Returns the holds released. */
export async function releaseExpiredHolds(showId?: string): Promise<ReleasedHold[]> {
  const lapsed = await prisma.hold.findMany({
    where: { status: HoldStatus.ACTIVE, expiresAt: { lte: new Date() }, ...(showId ? { showId } : {}) },
    select: { id: true },
  });
  const released: ReleasedHold[] = [];
  for (const { id } of lapsed) {
    const result = await releaseHold(id, HoldStatus.EXPIRED);
    if (result) released.push(result);
  }
  return released;
}
