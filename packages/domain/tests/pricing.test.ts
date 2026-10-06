import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db/client';
import { minorToDecimal, quoteSeats, toMinorUnits } from '../src/pricing/pricing';
import { createShowFixture } from './fixtures';

describe('money conversion', () => {
  it('converts decimal prices to exact minor units, where float maths would drift', () => {
    expect(0.29 * 100).not.toBe(29);
    expect(toMinorUnits('0.29')).toBe(29);
    expect(toMinorUnits(12.5)).toBe(1250);
    expect(minorToDecimal(1999).toString()).toBe('19.99');
  });
});

describe('quoteSeats', () => {
  it('prices each seat by its category and totals in minor units', async () => {
    const { show, showSeatIds } = await createShowFixture({ seats: 3, price: 12.34 });

    const quote = await quoteSeats(prisma, show.id, showSeatIds.slice(0, 2));

    expect(quote.seats).toHaveLength(2);
    expect(quote.seats.every((seat) => seat.priceMinor === 1234)).toBe(true);
    expect(quote.totalMinor).toBe(2468);
  });
});
