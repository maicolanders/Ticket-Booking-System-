import { Prisma } from '@prisma/client';
import type { SeatStatus } from '@ticket/shared';
import type { Tx } from '../db/transaction';

export interface LockedSeat {
  id: string;
  showId: string;
  seatCategoryId: string;
  status: SeatStatus;
  holdId: string | null;
}

/**
 * Lock ShowSeat rows FOR UPDATE in primary-key order. Every transaction that
 * touches several seats takes its locks in this one global order, so two
 * overlapping multi-seat requests queue behind each other instead of deadlocking.
 */
export function lockSeats(tx: Tx, seatIds: string[]): Promise<LockedSeat[]> {
  if (seatIds.length === 0) return Promise.resolve([]);
  return tx.$queryRaw<LockedSeat[]>(
    Prisma.sql`SELECT "id", "showId", "seatCategoryId", "status", "holdId"
               FROM "ShowSeat"
               WHERE "id" IN (${Prisma.join(seatIds)})
               ORDER BY "id"
               FOR UPDATE`,
  );
}
