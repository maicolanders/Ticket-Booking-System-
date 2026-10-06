import { Prisma } from '@prisma/client';
import { HoldStatus, SeatStatus } from '@ticket/shared';
import { prisma } from '../db/client';
import { dbNow, runInTransaction, type Tx } from '../db/transaction';
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

export interface PlaceHoldInput {
  userId: string;
  showId: string;
  seatIds: string[];
  ttlSeconds: number;
}

type HoldEnd = typeof HoldStatus.RELEASED | typeof HoldStatus.EXPIRED;

/**
 * A hold protects its seats only while ACTIVE and unexpired. Authoritative checks
 * pass the database clock (dbNow); the app clock default only suits early fail-fast checks.
 */
export const isHoldActive = (hold: { status: string; expiresAt: Date }, now = new Date()): boolean =>
  hold.status === HoldStatus.ACTIVE && hold.expiresAt.getTime() > now.getTime();

/**
 * Inside the caller's transaction, expire ACTIVE holds that have lapsed and still
 * own some of the locked seats. Correctness never depends on the sweeper's timing.
 */
async function expireLapsedHolds(tx: Tx, holdIds: string[], now: Date): Promise<void> {
  if (holdIds.length === 0) return;
  const lapsed = await tx.hold.findMany({
    where: { id: { in: holdIds }, status: HoldStatus.ACTIVE, expiresAt: { lte: now } },
    select: { id: true },
  });
  for (const { id } of lapsed) {
    await tx.hold.update({ where: { id }, data: { status: HoldStatus.EXPIRED } });
    await releaseHeldSeats(tx, id);
  }
}

/**
 * Hold seats for `ttlSeconds`, all or nothing, inside the caller's transaction.
 * Concurrent requests for the same seat serialise on the row locks: the first
 * commits HELD, the rest see HELD and get a `conflict`.
 */
export async function placeHoldTx(tx: Tx, input: PlaceHoldInput): Promise<PlacedHold> {
  const seatIds = [...new Set(input.seatIds)];
  if (seatIds.length === 0) throw new DomainError('invalid', 'Select at least one seat');

  const show = await tx.show.findUnique({ where: { id: input.showId }, select: { id: true } });
  if (!show) throw new DomainError('not_found', 'Show not found');

  const locked = await lockSeats(tx, seatIds);
  if (locked.length !== seatIds.length) throw new DomainError('invalid', 'One or more seats do not exist');
  if (locked.some((seat) => seat.showId !== input.showId)) {
    throw new DomainError('invalid', 'Seats do not belong to this show');
  }

  const now = await dbNow(tx);
  const heldBy = locked.flatMap((seat) => (seat.status === SeatStatus.HELD && seat.holdId ? [seat.holdId] : []));
  await expireLapsedHolds(tx, [...new Set(heldBy)], now);

  const unavailable = await tx.showSeat.findMany({
    where: { id: { in: seatIds }, status: { not: SeatStatus.AVAILABLE } },
    select: { id: true },
  });
  if (unavailable.length > 0) {
    throw new DomainError('conflict', 'Some of the selected seats are no longer available', {
      seatIds: unavailable.map((seat) => seat.id),
    });
  }

  const hold = await tx.hold.create({
    data: {
      showId: input.showId,
      userId: input.userId,
      expiresAt: new Date(now.getTime() + input.ttlSeconds * 1000),
    },
  });
  await holdSeats(tx, seatIds, hold.id);
  const quote = await quoteSeats(tx, input.showId, seatIds);
  return { holdId: hold.id, showId: input.showId, seatIds, expiresAt: hold.expiresAt, quote };
}

export const placeHold = (input: PlaceHoldInput): Promise<PlacedHold> =>
  runInTransaction((tx) => placeHoldTx(tx, input));

/**
 * Inside the caller's transaction, end a hold that is in one of `from` and free
 * its seats. Conditional, so exactly one caller wins; the rest get null.
 * Locks seats before the hold row: the same order placeHoldTx uses.
 */
export async function endHoldTx(
  tx: Tx,
  holdId: string,
  from: HoldStatus[],
  to: HoldStatus,
): Promise<ReleasedHold | null> {
  const hold = await tx.hold.findUnique({
    where: { id: holdId },
    select: { showId: true, seats: { select: { id: true } } },
  });
  if (!hold) return null;

  const locked = await lockSeats(
    tx,
    hold.seats.map((seat) => seat.id),
  );
  const { count } = await tx.hold.updateMany({
    where: { id: holdId, status: { in: from } },
    data: { status: to },
  });
  if (count === 0) return null;

  await releaseHeldSeats(tx, holdId);
  return {
    holdId,
    showId: hold.showId,
    seatIds: locked.filter((seat) => seat.holdId === holdId).map((seat) => seat.id),
  };
}

/**
 * End an ACTIVE hold and free its seats. Idempotent and race-safe: only the
 * caller that flips the hold out of ACTIVE releases the seats; everyone else
 * (a repeat call, the sweeper, a hold already converted to a booking) gets null.
 */
export const releaseHold = (holdId: string, outcome: HoldEnd): Promise<ReleasedHold | null> =>
  runInTransaction((tx) => endHoldTx(tx, holdId, [HoldStatus.ACTIVE], outcome));

/**
 * Expire every lapsed ACTIVE hold that no checkout owns, optionally for one show.
 * A checkout hold's lifetime belongs to its orchestration (durable timer); the
 * checkout recovery job is the backstop for those.
 */
export async function releaseExpiredHolds(showId?: string): Promise<ReleasedHold[]> {
  const lapsed = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT h."id" FROM "Hold" h
    WHERE h."status" = 'ACTIVE' AND h."expiresAt" <= now()
      AND NOT EXISTS (SELECT 1 FROM "Checkout" c WHERE c."holdId" = h."id")
      ${showId ? Prisma.sql`AND h."showId" = ${showId}` : Prisma.empty}`;
  const released: ReleasedHold[] = [];
  for (const { id } of lapsed) {
    const result = await releaseHold(id, HoldStatus.EXPIRED);
    if (result) released.push(result);
  }
  return released;
}
