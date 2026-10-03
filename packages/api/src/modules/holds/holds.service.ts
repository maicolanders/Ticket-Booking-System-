import {
  prisma,
  placeHold,
  releaseHold as endHold,
  releaseExpiredHolds as expireHolds,
  minorToMajor,
  type ReleasedHold,
} from '@ticket/domain';
import { env } from '../../config/env';
import { notFound, forbidden, rethrowAsHttp } from '../../lib/errors';
import { emitSeatUpdate } from '../../realtime/io';
import { SeatStatus, HoldStatus, SocketEvents, type HoldDTO } from '@ticket/shared';

// Thin adapter over the domain hold rules: authorisation, realtime fan-out, DTOs.

const announceReleased = (hold: ReleasedHold) =>
  emitSeatUpdate(SocketEvents.SEAT_RELEASED, hold.showId, hold.seatIds, SeatStatus.AVAILABLE);

/** Place a hold on the requested seats (409 if any is taken). */
export async function createHold(userId: string, showId: string, seatIds: string[]): Promise<HoldDTO> {
  const hold = await placeHold({ userId, showId, seatIds, ttlSeconds: env.HOLD_TTL_SECONDS }).catch(
    rethrowAsHttp,
  );
  emitSeatUpdate(SocketEvents.SEAT_HELD, showId, hold.seatIds, SeatStatus.HELD);
  return {
    id: hold.holdId,
    showId,
    seatIds: hold.seatIds,
    expiresAt: hold.expiresAt.toISOString(),
    totalAmount: minorToMajor(hold.quote.totalMinor),
  };
}

/** Release a hold early (checkout abandoned). Idempotent for non-active holds. */
export async function releaseHold(userId: string, holdId: string): Promise<void> {
  const hold = await prisma.hold.findUnique({ where: { id: holdId }, select: { userId: true } });
  if (!hold) throw notFound('Hold not found');
  if (hold.userId !== userId) throw forbidden('This hold does not belong to you');

  const released = await endHold(holdId, HoldStatus.RELEASED);
  if (released) announceReleased(released);
}

/**
 * Release all expired active holds (optionally scoped to one show). Used by the
 * background sweeper and as a lazy backstop when reading a seat map.
 * Returns the number of holds released.
 */
export async function releaseExpiredHolds(showId?: string): Promise<number> {
  const released = await expireHolds(showId);
  released.filter((hold) => hold.seatIds.length > 0).forEach(announceReleased);
  return released.length;
}
