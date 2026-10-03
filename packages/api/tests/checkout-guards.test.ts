import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { createCheckout, holdCheckoutSeats } from '@ticket/domain';
import { releaseHold } from '../src/modules/holds/holds.service';
import { createBooking } from '../src/modules/bookings/bookings.service';
import { createShowFixture, createUser } from '@ticket/domain/testing';

/** Legacy endpoints must not bypass the checkout saga on a hold it owns. */
describe('legacy endpoints on a checkout-owned hold', () => {
  it('refuse to release or book it', async () => {
    const { show, showSeatIds } = await createShowFixture({ seats: 1 });
    const user = await createUser('CUSTOMER');
    const checkoutId = randomUUID();
    await createCheckout({
      checkoutId,
      correlationId: randomUUID(),
      userId: user.id,
      showId: show.id,
      seatIds: showSeatIds,
    });
    const { holdId } = await holdCheckoutSeats(checkoutId, 60);

    await expect(releaseHold(user.id, holdId!)).rejects.toMatchObject({ status: 409 });
    await expect(createBooking(user.id, holdId!, 'tok_ok')).rejects.toMatchObject({ status: 409 });
  });
});
