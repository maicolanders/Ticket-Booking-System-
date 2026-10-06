/*
 * Restart drill: kill the Functions host (SIGKILL) while a checkout's charge is in
 * flight, start it again, and check the checkout still ends CONFIRMED with exactly
 * one charge and its seat BOOKED. Durable Task Scheduler redelivers the
 * interrupted work; the charge is repeated with the same idempotency key.
 *
 * Needs infra (npm run infra:up), the seeded legacy API on :4000, and port 7071
 * free (the drill starts and kills its own host).
 */
import { spawn, type ChildProcess } from 'node:child_process';

const functionsDir = new URL('../packages/functions/', import.meta.url).pathname;
const checkoutApi = 'http://localhost:7071/api';
const legacyApi = 'http://localhost:4000/api';
const simulator = 'http://localhost:4100';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${url} → ${response.status} ${await response.text()}`);
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function until<T>(what: string, probe: () => Promise<T | undefined>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(500);
  }
}

function startHost(): ChildProcess {
  // Own process group, so the whole host tree can be killed at once.
  const host = spawn('func', ['start', '--port', '7071'], { cwd: functionsDir, detached: true, stdio: 'ignore' });
  return host;
}

const killHost = (host: ChildProcess) => process.kill(-host.pid!, 'SIGKILL');
const hostReady = () =>
  until('the Functions host', async () => ((await fetch(`${checkoutApi}/checkouts/probe`)).status === 401 ? true : undefined), 120_000);

async function main(): Promise<void> {
  const { token } = await request<{ token: string }>(`${legacyApi}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'carol@ticket.dev', password: 'password123' }),
  });
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const [event] = await request<Array<{ id: string }>>(`${legacyApi}/events?search=Interstellar`);
  const { shows } = await request<{ shows: Array<{ id: string }> }>(`${legacyApi}/events/${event.id}`);
  const { seats } = await request<{ seats: Array<{ id: string; status: string }> }>(`${legacyApi}/shows/${shows[0].id}/seats`);
  const seat = seats.find((s) => s.status === 'AVAILABLE');
  if (!seat) throw new Error('No available seat on the seeded show; run npm run db:seed');

  console.log('1. starting the Functions host');
  let host = startHost();
  await hostReady();

  const { checkoutId } = await request<{ checkoutId: string }>(`${checkoutApi}/checkouts`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ showId: shows[0].id, seatIds: [seat.id] }),
  });
  const status = () => request<{ status: string; correlationId: string }>(`${checkoutApi}/checkouts/${checkoutId}`, { headers: auth });
  const reach = (wanted: string, timeoutMs: number) =>
    until(wanted, async () => ((await status()).status === wanted ? true : undefined), timeoutMs);
  await reach('AWAITING_PAYMENT', 30_000);

  console.log(`2. paying checkout ${checkoutId} with tok_slow (the charge takes ~5s)`);
  await request(`${checkoutApi}/checkouts/${checkoutId}/payment`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ paymentToken: 'tok_slow' }),
  });
  await reach('PROCESSING_PAYMENT', 30_000);
  await sleep(1_000);

  console.log('3. SIGKILL the host mid-charge, then start it again');
  killHost(host);
  await sleep(2_000);
  host = startHost();
  await hostReady();

  try {
    await reach('CONFIRMED', 120_000);
    const ledger = await request<{ charges: Array<{ metadata: Record<string, string> }> }>(`${simulator}/__admin/ledger`);
    const charges = ledger.charges.filter((c) => c.metadata.checkoutId === checkoutId).length;
    const seatNow = (await request<{ seats: Array<{ id: string; status: string }> }>(`${legacyApi}/shows/${shows[0].id}/seats`))
      .seats.find((s) => s.id === seat.id)?.status;
    console.log(`4. checkout CONFIRMED · charges for it: ${charges} · seat: ${seatNow}`);
    if (charges !== 1 || seatNow !== 'BOOKED') throw new Error('Restart drill FAILED');
    console.log('PASS: survived a host crash mid-charge with exactly one charge');
  } finally {
    killHost(host);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
