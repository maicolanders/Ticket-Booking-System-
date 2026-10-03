import type { Checkout } from '@prisma/client';
import {
  CheckoutStatus,
  HoldStatus,
  SeatStatus,
  TERMINAL_CHECKOUT_STATUSES,
  type CheckoutStatusDTO,
} from '@ticket/shared';
import { createBooking, inBookingTransaction } from '../bookings/bookings';
import { prisma } from '../db/client';
import { runInTransaction, type Tx } from '../db/transaction';
import { DomainError } from '../errors';
import { endHoldTx, isHoldActive, placeHoldTx } from '../holds/holds';
import { lockSeats } from '../seats/seats';

/*
 * Checkout state machine. Every operation below is one transaction that locks the
 * Checkout row first (lock order: Checkout → ShowSeat → Hold → Booking) and is
 * idempotent: when the checkout has already moved past the operation's starting
 * state, it returns the current state instead of repeating the effect. That is
 * what makes every orchestration activity safe to retry.
 */

export type { Checkout };

const NEXT: Record<CheckoutStatus, readonly CheckoutStatus[]> = {
  PENDING: ['AWAITING_PAYMENT', 'REJECTED', 'FAILED'],
  AWAITING_PAYMENT: ['PROCESSING_PAYMENT', 'EXPIRED', 'CANCELLED', 'FAILED'],
  PROCESSING_PAYMENT: ['CONFIRMED', 'PAYMENT_DECLINED', 'REFUNDED', 'CANCELLED', 'FAILED'],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
  CONFIRMED: [],
  PAYMENT_DECLINED: [],
  REFUNDED: [],
  FAILED: [],
};

export const isTerminal = (status: CheckoutStatus): boolean => TERMINAL_CHECKOUT_STATUSES.includes(status);

export const toCheckoutStatusDTO = (checkout: Checkout): CheckoutStatusDTO => ({
  checkoutId: checkout.id,
  correlationId: checkout.correlationId,
  status: checkout.status,
  seatIds: checkout.seatIds,
  holdExpiresAt: checkout.holdExpiresAt?.toISOString() ?? null,
  amountDue: checkout.amountDue,
  bookingReference: checkout.bookingReference,
  failureReason: checkout.failureReason,
  updatedAt: checkout.updatedAt.toISOString(),
});

async function findLockedCheckout(tx: Tx, checkoutId: string): Promise<Checkout | null> {
  const rows = await tx.$queryRaw<Checkout[]>`SELECT * FROM "Checkout" WHERE "id" = ${checkoutId} FOR UPDATE`;
  return rows[0] ?? null;
}

async function lockCheckout(tx: Tx, checkoutId: string): Promise<Checkout> {
  const checkout = await findLockedCheckout(tx, checkoutId);
  if (!checkout) throw new DomainError('not_found', 'Checkout not found');
  return checkout;
}

function transition(
  tx: Tx,
  checkout: Checkout,
  to: CheckoutStatus,
  data: Partial<Pick<Checkout, 'holdId' | 'holdExpiresAt' | 'amountDue' | 'failureReason'>> = {},
): Promise<Checkout> {
  if (!NEXT[checkout.status].includes(to)) {
    throw new Error(`Illegal checkout transition ${checkout.status} → ${to} (${checkout.id})`);
  }
  return tx.checkout.update({ where: { id: checkout.id }, data: { ...data, status: to } });
}

/** Lock a hold's seats, then read the hold: its state can no longer change under us. */
async function lockHold(tx: Tx, holdId: string) {
  const seats = await tx.showSeat.findMany({ where: { holdId }, select: { id: true } });
  const locked = await lockSeats(
    tx,
    seats.map((seat) => seat.id),
  );
  const hold = await tx.hold.findUniqueOrThrow({ where: { id: holdId } });
  const seatIds = locked.filter((seat) => seat.holdId === holdId && seat.status === SeatStatus.HELD);
  return { hold, seatIds: seatIds.map((seat) => seat.id) };
}

export interface StartCheckoutInput {
  checkoutId: string;
  correlationId: string;
  userId: string;
  showId: string;
  seatIds: string[];
}

/** Record a new PENDING checkout. Idempotent on checkoutId. */
export async function createCheckout(input: StartCheckoutInput): Promise<Checkout> {
  const show = await prisma.show.findUnique({ where: { id: input.showId }, select: { id: true } });
  if (!show) throw new DomainError('invalid', 'Show not found');
  return prisma.checkout.upsert({
    where: { id: input.checkoutId },
    create: {
      id: input.checkoutId,
      correlationId: input.correlationId,
      userId: input.userId,
      showId: input.showId,
      seatIds: [...new Set(input.seatIds)],
    },
    update: {},
  });
}

export const getCheckout = (checkoutId: string): Promise<Checkout | null> =>
  prisma.checkout.findUnique({ where: { id: checkoutId } });

/** PENDING → AWAITING_PAYMENT (seats held, amount quoted) or REJECTED (seats unavailable). */
export function holdCheckoutSeats(checkoutId: string, ttlSeconds: number): Promise<Checkout> {
  return runInTransaction(async (tx) => {
    const checkout = await lockCheckout(tx, checkoutId);
    if (checkout.status !== CheckoutStatus.PENDING) return checkout;
    try {
      const hold = await placeHoldTx(tx, {
        userId: checkout.userId,
        showId: checkout.showId,
        seatIds: checkout.seatIds,
        ttlSeconds,
      });
      return transition(tx, checkout, CheckoutStatus.AWAITING_PAYMENT, {
        holdId: hold.holdId,
        holdExpiresAt: hold.expiresAt,
        amountDue: hold.quote.totalMinor,
      });
    } catch (error) {
      // Refusals happen before placeHoldTx writes anything, so the transaction is still usable.
      if (!(error instanceof DomainError)) throw error;
      return transition(tx, checkout, CheckoutStatus.REJECTED, { failureReason: error.message });
    }
  });
}

export type BeginPaymentOutcome = 'processing' | 'expired' | 'not_payable';

/**
 * AWAITING_PAYMENT → PROCESSING_PAYMENT, judged by the database clock. The hold
 * moves ACTIVE → CAPTURING, so neither the sweeper nor a lazy expiry can free the
 * seats while money is in flight. A lapsed hold ends the checkout as EXPIRED.
 */
export function beginCheckoutPayment(
  checkoutId: string,
): Promise<{ checkout: Checkout; outcome: BeginPaymentOutcome }> {
  return runInTransaction(async (tx) => {
    const checkout = await lockCheckout(tx, checkoutId);
    if (checkout.status === CheckoutStatus.PROCESSING_PAYMENT) return { checkout, outcome: 'processing' };
    if (checkout.status !== CheckoutStatus.AWAITING_PAYMENT || !checkout.holdId) {
      return { checkout, outcome: 'not_payable' };
    }

    const { hold } = await lockHold(tx, checkout.holdId);
    if (isHoldActive(hold)) {
      await tx.hold.update({ where: { id: hold.id }, data: { status: HoldStatus.CAPTURING } });
      return { checkout: await transition(tx, checkout, CheckoutStatus.PROCESSING_PAYMENT), outcome: 'processing' };
    }
    await endHoldTx(tx, hold.id, [HoldStatus.ACTIVE], HoldStatus.EXPIRED);
    return { checkout: await transition(tx, checkout, CheckoutStatus.EXPIRED), outcome: 'expired' };
  });
}

export type ConfirmOutcome = 'booked' | 'cancel_requested' | 'not_confirmable';

/**
 * After a successful charge: convert the CAPTURING hold into a booking paid by
 * `chargeId`. The status stays PROCESSING_PAYMENT until the ticket is sent
 * (completeCheckout). A pending customer cancellation wins over booking.
 */
export function confirmCheckoutBooking(
  checkoutId: string,
  chargeId: string,
): Promise<{ checkout: Checkout; outcome: ConfirmOutcome }> {
  return inBookingTransaction(async (tx) => {
    let checkout = await lockCheckout(tx, checkoutId);
    if (checkout.bookingId) return { checkout, outcome: 'booked' };
    const { holdId } = checkout;
    if (checkout.status !== CheckoutStatus.PROCESSING_PAYMENT || !holdId) {
      return { checkout, outcome: 'not_confirmable' };
    }
    checkout = await tx.checkout.update({ where: { id: checkoutId }, data: { chargeId } });
    if (checkout.cancelRequestedAt) return { checkout, outcome: 'cancel_requested' };

    const { hold, seatIds } = await lockHold(tx, holdId);
    if (hold.status !== HoldStatus.CAPTURING || seatIds.length !== checkout.seatIds.length) {
      return { checkout, outcome: 'not_confirmable' };
    }
    await tx.hold.update({ where: { id: hold.id }, data: { status: HoldStatus.CONVERTED } });
    const booking = await createBooking(tx, {
      userId: checkout.userId,
      showId: checkout.showId,
      seatIds,
      chargeId,
    });
    checkout = await tx.checkout.update({
      where: { id: checkoutId },
      data: { bookingId: booking.bookingId, bookingReference: booking.reference },
    });
    return { checkout, outcome: 'booked' };
  });
}

/** PROCESSING_PAYMENT with a booking → CONFIRMED, once the ticket has been sent. */
export function completeCheckout(checkoutId: string): Promise<Checkout> {
  return runInTransaction(async (tx) => {
    const checkout = await lockCheckout(tx, checkoutId);
    if (checkout.status === CheckoutStatus.CONFIRMED) return checkout;
    if (!checkout.bookingId) throw new Error(`Checkout ${checkoutId} has no booking to confirm`);
    return transition(tx, checkout, CheckoutStatus.CONFIRMED);
  });
}

type ReleaseStatus =
  | typeof CheckoutStatus.EXPIRED
  | typeof CheckoutStatus.CANCELLED
  | typeof CheckoutStatus.PAYMENT_DECLINED
  | typeof CheckoutStatus.REFUNDED;

/**
 * End a checkout without a booking: free its seats (whether the hold is ACTIVE or
 * CAPTURING) and record the terminal status. A no-op on a terminal checkout.
 */
export function releaseCheckout(checkoutId: string, to: ReleaseStatus, failureReason?: string): Promise<Checkout> {
  return runInTransaction(async (tx) => {
    const checkout = await lockCheckout(tx, checkoutId);
    if (isTerminal(checkout.status)) return checkout;
    if (checkout.holdId) {
      const holdEnd = to === CheckoutStatus.EXPIRED ? HoldStatus.EXPIRED : HoldStatus.RELEASED;
      await endHoldTx(tx, checkout.holdId, [HoldStatus.ACTIVE, HoldStatus.CAPTURING], holdEnd);
    }
    return transition(tx, checkout, to, { failureReason: failureReason ?? null });
  });
}

/**
 * Give up and hand over to an operator. Seats stay held on purpose: when the
 * payment outcome is unknown, reselling them could sell a seat already paid for.
 */
export function failCheckout(checkoutId: string, failureReason: string): Promise<Checkout> {
  return runInTransaction(async (tx) => {
    const checkout = await lockCheckout(tx, checkoutId);
    if (isTerminal(checkout.status)) return checkout;
    return transition(tx, checkout, CheckoutStatus.FAILED, { failureReason });
  });
}

export type CancelRequestOutcome = 'accepted' | 'not_found' | 'too_late';

/** Record a customer cancellation. Refused once terminal or once a booking exists. */
export function requestCheckoutCancel(checkoutId: string, userId: string): Promise<CancelRequestOutcome> {
  return runInTransaction(async (tx) => {
    const checkout = await findLockedCheckout(tx, checkoutId);
    if (!checkout || checkout.userId !== userId) return 'not_found';
    if (isTerminal(checkout.status) || checkout.bookingId) return 'too_late';
    if (!checkout.cancelRequestedAt) {
      await tx.checkout.update({ where: { id: checkoutId }, data: { cancelRequestedAt: new Date() } });
    }
    return 'accepted';
  });
}
