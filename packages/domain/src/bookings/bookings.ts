import { Prisma } from '@prisma/client';
import { BookingStatus, HoldStatus, SeatStatus } from '@ticket/shared';
import { signTicketToken } from '../auth/tokens';
import { dbNow, runInTransaction, type Tx } from '../db/transaction';
import { DomainError } from '../errors';
import { isHoldActive } from '../holds/holds';
import { bookingReference } from '../ids';
import { minorToDecimal, quoteSeats } from '../pricing/pricing';
import { bookSeats, freeBookedSeats, lockSeats } from '../seats/seats';

export interface CreatedBooking {
  bookingId: string;
  reference: string;
  showId: string;
  seatIds: string[];
  totalMinor: number;
}

/** The payment behind a booking: our idempotency key (unique) and the provider's charge id. */
export interface BookingPayment {
  paymentKey?: string;
  chargeId?: string;
}

const MAX_REFERENCE_ATTEMPTS = 3;

const isReferenceCollision = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002' &&
  JSON.stringify(error.meta?.target ?? '').includes('reference');

/**
 * runInTransaction for work that creates a booking. A booking reference is a
 * short random code, so a unique collision is possible (if unlikely); the
 * transaction rolls back entirely and is retried with a fresh reference.
 */
export async function inBookingTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await runInTransaction(work);
    } catch (error) {
      if (attempt >= MAX_REFERENCE_ATTEMPTS || !isReferenceCollision(error)) throw error;
    }
  }
}

/**
 * The single booking-creation rule: price the seats, write a CONFIRMED booking
 * with a signed QR token, and move the seats HELD → BOOKED. The caller must
 * already hold the seat locks and have checked the seats are reserved for this
 * customer (by a checkout hold or a waitlist offer).
 */
export async function createBooking(
  tx: Tx,
  input: { userId: string; showId: string; seatIds: string[] } & BookingPayment,
): Promise<CreatedBooking> {
  const quote = await quoteSeats(tx, input.showId, input.seatIds);
  const reference = bookingReference();
  const booking = await tx.booking.create({
    data: {
      reference,
      showId: input.showId,
      userId: input.userId,
      status: BookingStatus.CONFIRMED,
      totalAmount: minorToDecimal(quote.totalMinor),
      qrToken: signTicketToken(reference),
      chargeId: input.chargeId,
      paymentKey: input.paymentKey,
      seats: {
        create: quote.seats.map((seat) => ({
          showSeatId: seat.showSeatId,
          priceAtBooking: minorToDecimal(seat.priceMinor),
        })),
      },
    },
  });
  await bookSeats(tx, input.seatIds);
  return {
    bookingId: booking.id,
    reference,
    showId: input.showId,
    seatIds: input.seatIds,
    totalMinor: quote.totalMinor,
  };
}

/** Convert an ACTIVE, unexpired hold into a confirmed booking for its owner, paid by `payment`. */
export function convertHoldToBooking(
  holdId: string,
  payment: BookingPayment = {},
): Promise<CreatedBooking> {
  return inBookingTransaction(async (tx) => {
    const hold = await tx.hold.findUnique({
      where: { id: holdId },
      select: { showId: true, userId: true, seats: { select: { id: true } } },
    });
    if (!hold) throw new DomainError('not_found', 'Hold not found');
    const seatIds = hold.seats.map((seat) => seat.id);

    // Judge the hold only once its seats are locked: every hold transition happens
    // under those locks, so a concurrent conversion, release, or expiry is settled by now.
    const locked = await lockSeats(tx, seatIds);
    const current = await tx.hold.findUniqueOrThrow({
      where: { id: holdId },
      select: { status: true, expiresAt: true },
    });
    if (current.status !== HoldStatus.ACTIVE)
      throw new DomainError('conflict', 'This hold is no longer active');
    if (!isHoldActive(current, await dbNow(tx))) throw new DomainError('expired', 'Your seat hold has expired');
    if (seatIds.length === 0) throw new DomainError('conflict', 'This hold has no seats');

    const stillHeld =
      locked.length === seatIds.length &&
      locked.every((seat) => seat.status === SeatStatus.HELD && seat.holdId === holdId);
    if (!stillHeld) {
      throw new DomainError('expired', 'Your held seats are no longer valid — the hold may have expired');
    }

    const { count } = await tx.hold.updateMany({
      where: { id: holdId, status: HoldStatus.ACTIVE },
      data: { status: HoldStatus.CONVERTED },
    });
    if (count !== 1) throw new DomainError('conflict', 'This hold is no longer active');

    return createBooking(tx, {
      userId: hold.userId,
      showId: hold.showId,
      seatIds,
      ...payment,
    });
  });
}

/** Cancel a CONFIRMED booking and return its seats to AVAILABLE. */
export function cancelBooking(bookingId: string): Promise<{ showId: string; seatIds: string[] }> {
  return runInTransaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      select: { showId: true, seats: { select: { showSeatId: true } } },
    });
    if (!booking) throw new DomainError('not_found', 'Booking not found');

    const seatIds = booking.seats.map((seat) => seat.showSeatId);
    await lockSeats(tx, seatIds);
    const { count } = await tx.booking.updateMany({
      where: { id: bookingId, status: BookingStatus.CONFIRMED },
      data: { status: BookingStatus.CANCELLED, cancelledAt: new Date() },
    });
    if (count === 0) throw new DomainError('conflict', 'This booking is already cancelled');

    if (seatIds.length > 0) await freeBookedSeats(tx, seatIds);
    return { showId: booking.showId, seatIds };
  });
}
