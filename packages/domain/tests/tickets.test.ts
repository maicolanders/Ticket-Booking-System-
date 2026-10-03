import { describe, expect, it } from 'vitest';
import { convertHoldToBooking } from '../src/bookings/bookings';
import { placeHold } from '../src/holds/holds';
import { deliverTicket } from '../src/tickets/tickets';
import type { MailInput } from '../src/tickets/mailer';
import { createShowFixture, createUser } from './fixtures';

async function newBooking() {
  const { show, showSeatIds } = await createShowFixture({ seats: 1, price: 10 });
  const user = await createUser();
  const hold = await placeHold({ userId: user.id, showId: show.id, seatIds: showSeatIds, ttlSeconds: 60 });
  return convertHoldToBooking(hold.holdId);
}

describe('deliverTicket', () => {
  it('emails the QR ticket once and skips repeats', async () => {
    const booking = await newBooking();
    const sent: MailInput[] = [];
    const mailer = { send: async (mail: MailInput) => void sent.push(mail) };

    expect(await deliverTicket(booking.bookingId, mailer)).toBe('sent');
    expect(await deliverTicket(booking.bookingId, mailer)).toBe('already_sent');

    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain(booking.reference);
    expect(sent[0].attachments?.[0].filename).toBe(`${booking.reference}.png`);
  });

  it('does not record a delivery that failed, so a retry sends it', async () => {
    const booking = await newBooking();
    const failing = { send: async () => Promise.reject(new Error('smtp down')) };
    const sent: MailInput[] = [];

    await expect(deliverTicket(booking.bookingId, failing)).rejects.toThrow('smtp down');
    expect(await deliverTicket(booking.bookingId, { send: async (mail) => void sent.push(mail) })).toBe('sent');
    expect(sent).toHaveLength(1);
  });
});
