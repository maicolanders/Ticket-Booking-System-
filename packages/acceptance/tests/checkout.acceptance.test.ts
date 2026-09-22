import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const checkoutBase = process.env.CHECKOUT_API_URL ?? 'http://localhost:7071/api';
const legacyBase = process.env.LEGACY_API_URL ?? 'http://localhost:4000/api';
const simulatorBase = process.env.PAYMENT_API_URL ?? 'http://localhost:4100';
const mailpitBase = process.env.MAILPIT_API_URL ?? 'http://localhost:8025';
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://ticket:ticket@localhost:5433/ticketing?schema=public';

interface CheckoutStatus {
  checkoutId: string;
  correlationId: string;
  status: string;
  seatIds: string[];
  holdExpiresAt: string | null;
  amountDue: number | null;
  bookingReference: string | null;
  failureReason: string | null;
  updatedAt: string;
}

interface Fixture {
  token: string;
  showId: string;
  seatIds: string[];
}

const pool = new pg.Pool({ connectionString: databaseUrl });
let fixture: Fixture;

async function json<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${url} returned ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

async function login(email: string): Promise<string> {
  const response = await json<{ token: string }>(`${legacyBase}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  return response.token;
}

async function createFixture(): Promise<Fixture> {
  const [admin, organiser, customer] = await Promise.all([
    login('admin@ticket.dev'),
    login('organiser@ticket.dev'),
    login('bob@ticket.dev'),
  ]);
  const auth = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
  const suffix = randomUUID().slice(0, 8);
  const venue = await json<{ id: string }>(`${legacyBase}/venues`, {
    method: 'POST',
    headers: auth(admin),
    body: JSON.stringify({ name: `Acceptance ${suffix}`, address: 'Test address' }),
  });
  const category = await json<{ id: string }>(`${legacyBase}/venues/${venue.id}/categories`, {
    method: 'POST',
    headers: auth(admin),
    body: JSON.stringify({ name: 'General', color: '#336699' }),
  });
  await json(`${legacyBase}/venues/${venue.id}/seats`, {
    method: 'POST',
    headers: auth(admin),
    body: JSON.stringify({ sections: [{ categoryId: category.id, rowLabels: ['A'], seatsPerRow: 8 }] }),
  });
  const event = await json<{ id: string }>(`${legacyBase}/events`, {
    method: 'POST',
    headers: auth(organiser),
    body: JSON.stringify({ title: `Acceptance ${suffix}`, type: 'CONCERT' }),
  });
  const show = await json<{ id: string }>(`${legacyBase}/events/${event.id}/shows`, {
    method: 'POST',
    headers: auth(organiser),
    body: JSON.stringify({
      venueId: venue.id,
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      pricing: [{ seatCategoryId: category.id, price: 12.5 }],
    }),
  });
  const seatMap = await json<{ seats: Array<{ id: string }> }>(`${legacyBase}/shows/${show.id}/seats`, {
    headers: auth(customer),
  });
  return { token: customer, showId: show.id, seatIds: seatMap.seats.map((seat) => seat.id) };
}

function checkoutHeaders(): Record<string, string> {
  return { authorization: `Bearer ${fixture.token}`, 'content-type': 'application/json' };
}

async function startCheckout(seatId: string): Promise<{ checkoutId: string; statusUrl: string }> {
  const response = await fetch(`${checkoutBase}/checkouts`, {
    method: 'POST',
    headers: checkoutHeaders(),
    body: JSON.stringify({ showId: fixture.showId, seatIds: [seatId] }),
  });
  if (response.status !== 202) {
    throw new Error(`POST ${checkoutBase}/checkouts returned ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as { checkoutId: string; statusUrl: string };
}

async function getStatus(checkoutId: string): Promise<CheckoutStatus> {
  return json(`${checkoutBase}/checkouts/${checkoutId}`, { headers: checkoutHeaders() });
}

async function waitFor(checkoutId: string, statuses: string[], timeoutMs = 30_000): Promise<CheckoutStatus> {
  const deadline = Date.now() + timeoutMs;
  let current = await getStatus(checkoutId);
  while (!statuses.includes(current.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    current = await getStatus(checkoutId);
  }
  expect(statuses, `checkout stopped at ${current.status}`).toContain(current.status);
  return current;
}

async function postCheckout(checkoutId: string, action: string, body?: unknown): Promise<Response> {
  return fetch(`${checkoutBase}/checkouts/${checkoutId}/${action}`, {
    method: 'POST',
    headers: checkoutHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function seatStatus(seatId: string): Promise<string> {
  const result = await pool.query<{ status: string }>('SELECT status FROM "ShowSeat" WHERE id = $1', [seatId]);
  return result.rows[0]?.status ?? 'MISSING';
}

beforeAll(async () => {
  try {
    await fetch(`${checkoutBase}/checkouts/__acceptance_probe__`, { signal: AbortSignal.timeout(2000) });
  } catch {
    throw new Error(`Checkout API not reachable at ${checkoutBase}`);
  }
  await Promise.all([
    fetch(`${simulatorBase}/__admin/reset`, { method: 'POST' }),
    fetch(`${mailpitBase}/api/v1/messages`, { method: 'DELETE' }),
  ]);
  fixture = await createFixture();
});

afterAll(async () => pool.end());

describe('Checkout API contract', () => {
  it('confirms a paid checkout with one correlated charge and one ticket email', async () => {
    const started = await startCheckout(fixture.seatIds[0]);
    await waitFor(started.checkoutId, ['AWAITING_PAYMENT']);
    expect((await postCheckout(started.checkoutId, 'payment', { paymentToken: 'tok_ok' })).status).toBe(202);
    const status = await waitFor(started.checkoutId, ['CONFIRMED']);
    const ledger = await json<{
      charges: Array<{ id: string; amount: number; idempotencyKey: string; metadata: Record<string, string> }>;
      refunds: Array<{ chargeId: string }>;
    }>(`${simulatorBase}/__admin/ledger`);
    const charges = ledger.charges.filter((charge) => charge.metadata.checkoutId === started.checkoutId);
    expect(charges).toHaveLength(1);
    expect(charges[0].amount).toBe(status.amountDue);
    expect(ledger.refunds.filter((refund) => refund.chargeId === charges[0].id)).toHaveLength(0);
    const requests = await json<Array<{ idempotencyKey: string | null; correlationId: string | null }>>(
      `${simulatorBase}/__admin/requests`,
    );
    expect(requests.filter((entry) => entry.idempotencyKey === charges[0].idempotencyKey)).toSatisfy(
      (entries: Array<{ correlationId: string | null }>) =>
        entries.length > 0 && entries.every((entry) => entry.correlationId === status.correlationId),
    );
    expect(await seatStatus(fixture.seatIds[0])).toBe('BOOKED');
    const messages = await json<{ messages: Array<{ Subject: string }> }>(`${mailpitBase}/api/v1/messages`);
    expect(messages.messages.filter((message) => message.Subject.includes(status.bookingReference ?? ''))).toHaveLength(1);
  });

  it('expires an unpaid checkout and releases its seat', async () => {
    const started = await startCheckout(fixture.seatIds[1]);
    await waitFor(started.checkoutId, ['AWAITING_PAYMENT']);
    await waitFor(started.checkoutId, ['EXPIRED'], 20_000);
    expect(await seatStatus(fixture.seatIds[1])).toBe('AVAILABLE');
    const ledger = await json<{ charges: Array<{ metadata: Record<string, string> }> }>(
      `${simulatorBase}/__admin/ledger`,
    );
    expect(ledger.charges.filter((charge) => charge.metadata.checkoutId === started.checkoutId)).toHaveLength(0);
  });

  it('does not retry a declined charge and releases its seat', async () => {
    const started = await startCheckout(fixture.seatIds[2]);
    await waitFor(started.checkoutId, ['AWAITING_PAYMENT']);
    expect((await postCheckout(started.checkoutId, 'payment', { paymentToken: 'tok_decline' })).status).toBe(202);
    await waitFor(started.checkoutId, ['PAYMENT_DECLINED']);
    expect(await seatStatus(fixture.seatIds[2])).toBe('AVAILABLE');
    const ledger = await json<{ charges: Array<{ metadata: Record<string, string> }> }>(
      `${simulatorBase}/__admin/ledger`,
    );
    expect(ledger.charges.filter((charge) => charge.metadata.checkoutId === started.checkoutId)).toHaveLength(0);
    const requests = await json<Array<{ token: string | null }>>(`${simulatorBase}/__admin/requests`);
    expect(requests.filter((entry) => entry.token === 'tok_decline')).toHaveLength(1);
  });

  it('cancels while awaiting payment and releases its seat', async () => {
    const started = await startCheckout(fixture.seatIds[3]);
    await waitFor(started.checkoutId, ['AWAITING_PAYMENT']);
    expect((await postCheckout(started.checkoutId, 'cancel')).status).toBe(202);
    await waitFor(started.checkoutId, ['CANCELLED']);
    expect(await seatStatus(fixture.seatIds[3])).toBe('AVAILABLE');
    const ledger = await json<{ charges: Array<{ metadata: Record<string, string> }> }>(
      `${simulatorBase}/__admin/ledger`,
    );
    expect(ledger.charges.filter((charge) => charge.metadata.checkoutId === started.checkoutId)).toHaveLength(0);
  });
});
