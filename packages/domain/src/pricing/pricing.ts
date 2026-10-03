import { Prisma, type PrismaClient } from '@prisma/client';
import type { Tx } from '../db/transaction';

// Money crosses process boundaries (payment provider, Checkout API) as integer
// minor units. Prices stay DECIMAL(10,2) in PostgreSQL; these helpers are the
// only place the two representations meet, so no float rounding ever reaches a charge.
export const toMinorUnits = (amount: Prisma.Decimal | number | string): number =>
  new Prisma.Decimal(amount).mul(100).toDecimalPlaces(0).toNumber();

export const minorToDecimal = (minor: number): Prisma.Decimal => new Prisma.Decimal(minor).div(100);

/** For legacy DTOs, which expose amounts in major units. */
export const minorToMajor = (minor: number): number => minor / 100;

export interface PricedSeat {
  showSeatId: string;
  priceMinor: number;
}

export interface SeatQuote {
  seats: PricedSeat[];
  totalMinor: number;
}

/**
 * Price seats with their show's per-category pricing. The single pricing rule
 * used for holds, charges, and bookings. A category without a show price costs
 * 0, matching the legacy behaviour.
 */
export async function quoteSeats(db: Tx | PrismaClient, showId: string, seatIds: string[]): Promise<SeatQuote> {
  const [seats, pricing] = await Promise.all([
    db.showSeat.findMany({ where: { id: { in: seatIds } }, select: { id: true, seatCategoryId: true } }),
    db.showPricing.findMany({ where: { showId }, select: { seatCategoryId: true, price: true } }),
  ]);
  const priceByCategory = new Map(pricing.map((p) => [p.seatCategoryId, toMinorUnits(p.price)]));
  const priced = seats.map((seat) => ({
    showSeatId: seat.id,
    priceMinor: priceByCategory.get(seat.seatCategoryId) ?? 0,
  }));
  return { seats: priced, totalMinor: priced.reduce((sum, seat) => sum + seat.priceMinor, 0) };
}
