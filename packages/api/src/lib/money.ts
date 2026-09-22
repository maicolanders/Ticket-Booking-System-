import type { Prisma } from '@prisma/client';

/** Convert a Prisma Decimal (or number/string) to a plain number for DTOs and JS math. */
export const toMoney = (value: Prisma.Decimal | number | string): number => Number(value);

export const formatMoney = (value: Prisma.Decimal | number | string): string =>
  Number(value).toFixed(2);
