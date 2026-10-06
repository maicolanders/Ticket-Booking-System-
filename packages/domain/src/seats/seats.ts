import { Prisma } from '@prisma/client';
import { SeatStatus } from '@ticket/shared';
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

/*
 * Seat state machine: AVAILABLE → HELD → BOOKED → AVAILABLE (cancellation).
 * Each transition only matches rows in the expected source state, and the
 * all-or-nothing ones verify the row count, so a caller that skipped a check
 * fails loudly instead of silently overwriting another checkout's seat.
 */

function assertAll(count: number, expected: number, transition: string): void {
  if (count !== expected) {
    throw new Error(`Seat transition ${transition} matched ${count} of ${expected} seats`);
  }
}

export async function holdSeats(tx: Tx, seatIds: string[], holdId: string): Promise<void> {
  const { count } = await tx.showSeat.updateMany({
    where: { id: { in: seatIds }, status: SeatStatus.AVAILABLE },
    data: { status: SeatStatus.HELD, holdId },
  });
  assertAll(count, seatIds.length, 'AVAILABLE→HELD');
}

/** Return every seat a hold still owns to AVAILABLE. */
export function releaseHeldSeats(tx: Tx, holdId: string): Promise<Prisma.BatchPayload> {
  return tx.showSeat.updateMany({
    where: { holdId, status: SeatStatus.HELD },
    data: { status: SeatStatus.AVAILABLE, holdId: null },
  });
}

export async function bookSeats(tx: Tx, seatIds: string[]): Promise<void> {
  const { count } = await tx.showSeat.updateMany({
    where: { id: { in: seatIds }, status: SeatStatus.HELD },
    data: { status: SeatStatus.BOOKED, holdId: null },
  });
  assertAll(count, seatIds.length, 'HELD→BOOKED');
}

export async function freeBookedSeats(tx: Tx, seatIds: string[]): Promise<void> {
  const { count } = await tx.showSeat.updateMany({
    where: { id: { in: seatIds }, status: SeatStatus.BOOKED },
    data: { status: SeatStatus.AVAILABLE, holdId: null },
  });
  assertAll(count, seatIds.length, 'BOOKED→AVAILABLE');
}
