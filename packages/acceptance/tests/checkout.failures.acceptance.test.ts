import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Failure, contention and contract-edge scenarios beyond the public suite.
// Same prerequisites: infra up, legacy API, and the Functions app (HOLD_TTL_SECONDS=10).

const checkoutBase = process.env.CHECKOUT_API_URL ?? 'http://localhost:7071/api';
const legacyBase = process.env.LEGACY_API_URL ?? 'http://localhost:4000/api';
const simulatorBase = process.env.PAYMENT_API_URL ?? 'http://localhost:4100';
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://ticket:ticket@localhost:5433/ticketing?schema=public';

interface CheckoutStatus {
  checkoutId: string;
  correlationId: string;
  status: string;
  amountDue: number | null;
  bookingReference: string | null;
  failureReason: string | null;
}

interface Ledger {
  charges: Array<{ id: string; amount: number; metadata: Record<string, string> }>;
  refunds: Array<{ chargeId: string }>;
}

const pool = new pg.Pool({ connectionString: databaseUrl });
let token: string;
let otherToken: string;
let showId: string;
let seats: string[];
let nextSeat = 0;

async function json<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${url} returned ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

const login = async (email: string) =>
  (
    await json<{ token: string }>(`${legacyBase}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123' }),
    })
  ).token;

const headers = (bearer = token) => ({ authorization: `Bearer ${bearer}`, 'content-type': 'application/json' });

async function createShow(): Promise<{ showId: string; seatIds: string[] }> {
  const [admin, organiser] = await Promise.all([login('admin@ticket.dev'), login('organiser@ticket.dev')]);
  const suffix = randomUUID().slice(0, 8);
  const post = <T>(path: string, bearer: string, body: unknown) =>
    json<T>(`${legacyBase}${path}`, { method: 'POST', headers: headers(bearer), body: JSON.stringify(body) });
  const venue = await post<{ id: string }>('/venues', admin, { name: `Failures ${suffix}`, address: 'Test' });
  const category = await post<{ id: string }>(`/venues/${venue.id}/categories`, admin, { name: 'General' });
  await post(`/venues/${venue.id}/seats`, admin, {
    sections: [{ categoryId: category.id, rowLabels: ['A', 'B'], seatsPerRow: 10 }],
  });
  const event = await post<{ id: string }>('/events', organiser, { title: `Failures ${suffix}`, type: 'CONCERT' });
  const show = await post<{ id: string }>(`/events/${event.id}/shows`, organiser, {
    venueId: venue.id,
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    pricing: [{ seatCategoryId: category.id, price: 19.99 }],
  });
  const map = await json<{ seats: Array<{ id: string }> }>(`${legacyBase}/shows/${show.id}/seats`);
  return { showId: show.id, seatIds: map.seats.map((seat) => seat.id) };
}

async function start(seatIds = [seats[nextSeat++]], bearer = token): Promise<string> {
  const response = await fetch(`${checkoutBase}/checkouts`, {
    method: 'POST',
    headers: headers(bearer),
    body: JSON.stringify({ showId, seatIds }),
  });
  expect(response.status).toBe(202);
  return ((await response.json()) as { checkoutId: string }).checkoutId;
}

const status = (checkoutId: string) =>
  json<CheckoutStatus>(`${checkoutBase}/checkouts/${checkoutId}`, { headers: headers() });

async function waitFor(checkoutId: string, statuses: string[], timeoutMs = 45_000): Promise<CheckoutStatus> {
  const deadline = Date.now() + timeoutMs;
  let current = await status(checkoutId);
  while (!statuses.includes(current.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    current = await status(checkoutId);
  }
  expect(statuses, `checkout stopped at ${current.status}`).toContain(current.status);
  return current;
}

const post = (checkoutId: string, action: 'payment' | 'cancel', body?: unknown, bearer = token) =>
  fetch(`${checkoutBase}/checkouts/${checkoutId}/${action}`, {
    method: 'POST',
    headers: headers(bearer),
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function netCharges(checkoutId: string) {
  const ledger = await json<Ledger>(`${simulatorBase}/__admin/ledger`);
  const charges = ledger.charges.filter((charge) => charge.metadata.checkoutId === checkoutId);
  const refunded = charges.filter((charge) => ledger.refunds.some((refund) => refund.chargeId === charge.id));
  return { charges, net: charges.length - refunded.length };
}

const seatStatus = async (seatId: string) =>
  (await pool.query<{ status: string }>('SELECT status FROM "ShowSeat" WHERE id = $1', [seatId])).rows[0]?.status;

beforeAll(async () => {
  await fetch(`${simulatorBase}/__admin/faults`, { method: 'DELETE' });
  [token, otherToken] = await Promise.all([login('bob@ticket.dev'), login('carol@ticket.dev')]);
  ({ showId, seatIds: seats } = await createShow());
});

afterAll(async () => {
  await fetch(`${simulatorBase}/__admin/faults`, { method: 'DELETE' });
  await pool.end();
});

describe('contract edges', () => {
  it('answers 401 without a valid token and 400 for an invalid body', async () => {
    expect((await fetch(`${checkoutBase}/checkouts/anything`)).status).toBe(401);
    const noSeats = await fetch(`${checkoutBase}/checkouts`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ showId, seatIds: [] }),
    });
    expect(noSeats.status).toBe(400);
  });

  it("hides another customer's checkout behind a 404", async () => {
    const checkoutId = await start();
    await waitFor(checkoutId, ['AWAITING_PAYMENT']);
    const asOther = await fetch(`${checkoutBase}/checkouts/${checkoutId}`, { headers: headers(otherToken) });
    expect(asOther.status).toBe(404);
    expect((await post(checkoutId, 'cancel', undefined, otherToken)).status).toBe(404);
    await post(checkoutId, 'cancel');
  });

  it('reports amountDue in minor units and refuses payment once terminal', async () => {
    const checkoutId = await start();
    const awaiting = await waitFor(checkoutId, ['AWAITING_PAYMENT']);
    expect(awaiting.amountDue).toBe(1999);
    await post(checkoutId, 'cancel');
    await waitFor(checkoutId, ['CANCELLED']);
    expect((await post(checkoutId, 'payment', { paymentToken: 'tok_ok' })).status).toBe(409);
    expect((await post(checkoutId, 'cancel')).status).toBe(409);
  });
});

describe('seat contention', () => {
  it('holds a seat for exactly one of several concurrent checkouts', async () => {
    const seat = seats[nextSeat++];
    const ids = await Promise.all(Array.from({ length: 5 }, () => start([seat])));
    const final = await Promise.all(ids.map((id) => waitFor(id, ['AWAITING_PAYMENT', 'REJECTED'])));
    expect(final.filter((c) => c.status === 'AWAITING_PAYMENT')).toHaveLength(1);
    expect(final.filter((c) => c.status === 'REJECTED')).toHaveLength(4);
  });
});

describe('payment failures', () => {
  it('charges once however many times payment is submitted concurrently', async () => {
    const checkoutId = await start();
    await waitFor(checkoutId, ['AWAITING_PAYMENT']);
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => post(checkoutId, 'payment', { paymentToken: 'tok_ok' })),
    );
    expect(responses.every((r) => r.status === 202 || r.status === 409)).toBe(true);
    await waitFor(checkoutId, ['CONFIRMED']);
    expect((await netCharges(checkoutId)).charges).toHaveLength(1);
  });

  it('retries transient provider failures with the same key and confirms', async () => {
    const seatId = seats[nextSeat];
    const checkoutId = await start();
    await waitFor(checkoutId, ['AWAITING_PAYMENT']);
    await post(checkoutId, 'payment', { paymentToken: 'tok_flaky' });
    const confirmed = await waitFor(checkoutId, ['CONFIRMED']);
    const { charges } = await netCharges(checkoutId);
    expect(charges).toHaveLength(1);
    expect(charges[0].amount).toBe(confirmed.amountDue);
    expect(await seatStatus(seatId)).toBe('BOOKED');
  });

  it('resolves a charge whose response never arrives without charging twice', async () => {
    const checkoutId = await start();
    await waitFor(checkoutId, ['AWAITING_PAYMENT']);
    await post(checkoutId, 'payment', { paymentToken: 'tok_timeout' });
    await waitFor(checkoutId, ['CONFIRMED'], 60_000);
    expect((await netCharges(checkoutId)).net).toBe(1);
  }, 70_000);

  it('refunds when the customer cancels while the charge is in flight', async () => {
    const seatId = seats[nextSeat];
    const checkoutId = await start();
    await waitFor(checkoutId, ['AWAITING_PAYMENT']);
    await post(checkoutId, 'payment', { paymentToken: 'tok_slow' });
    await waitFor(checkoutId, ['PROCESSING_PAYMENT']);
    expect((await post(checkoutId, 'cancel')).status).toBe(202);
    await waitFor(checkoutId, ['CANCELLED'], 30_000);
    const { charges, net } = await netCharges(checkoutId);
    expect(charges).toHaveLength(1);
    expect(net).toBe(0);
    expect(await seatStatus(seatId)).toBe('AVAILABLE');
  });
});
