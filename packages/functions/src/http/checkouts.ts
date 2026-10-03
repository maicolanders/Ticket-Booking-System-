import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import * as df from 'durable-functions';
import { CheckoutStatus, startCheckoutSchema, submitPaymentSchema } from '@ticket/shared';
import {
  DomainError,
  createCheckout,
  failCheckout,
  getCheckout,
  requestCheckoutCancel,
  toCheckoutStatusDTO,
  verifyAuthToken,
} from '@ticket/domain';
import { logger } from '../logger';
import { CHECKOUT_ORCHESTRATOR, Events, type CheckoutRef, type PaymentSubmitted } from '../contracts';

// The Checkout API contract (CANDIDATE.md). Status reads come from PostgreSQL,
// the system of record, never from orchestration state.

const json = (status: number, body?: unknown): HttpResponseInit => ({ status, jsonBody: body });
const error = (status: number, message: string, details?: unknown) => json(status, { error: message, details });

/** The caller's user id from the legacy API's JWT, or null. */
function authenticate(request: HttpRequest): string | null {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  try {
    return verifyAuthToken(header.slice('Bearer '.length)).sub;
  } catch {
    return null;
  }
}

async function readJson(request: HttpRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/** A checkout the caller owns; anyone else's is indistinguishable from a missing one. */
async function ownedCheckout(checkoutId: string, userId: string) {
  const checkout = await getCheckout(checkoutId);
  return checkout && checkout.userId === userId ? checkout : null;
}

async function startCheckout(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const userId = authenticate(request);
  if (!userId) return error(401, 'Missing or invalid authentication token');
  const body = startCheckoutSchema.safeParse(await readJson(request));
  if (!body.success) return error(400, 'Invalid checkout request', body.error.flatten());

  const ref: CheckoutRef = { checkoutId: randomUUID(), correlationId: randomUUID() };
  const log = logger.child({ ...ref });
  try {
    await createCheckout({ ...ref, userId, ...body.data });
  } catch (err) {
    if (err instanceof DomainError) return error(400, err.message);
    throw err;
  }

  try {
    await df.getClient(context).startNew(CHECKOUT_ORCHESTRATOR, { instanceId: ref.checkoutId, input: ref });
  } catch (err) {
    log.error('checkout.start_failed', { err });
    await failCheckout(ref.checkoutId, 'orchestration could not be started', { releaseSeats: true });
    return error(503, 'Checkout could not be started, please retry');
  }
  log.info('checkout.accepted', { userId, showId: body.data.showId, seatCount: body.data.seatIds.length });
  const statusUrl = new URL(`/api/checkouts/${ref.checkoutId}`, request.url).toString();
  return json(202, { checkoutId: ref.checkoutId, statusUrl });
}

async function getCheckoutStatus(request: HttpRequest): Promise<HttpResponseInit> {
  const userId = authenticate(request);
  if (!userId) return error(401, 'Missing or invalid authentication token');
  const checkout = await ownedCheckout(request.params.checkoutId, userId);
  return checkout ? json(200, toCheckoutStatusDTO(checkout)) : error(404, 'Checkout not found');
}

async function submitPayment(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const userId = authenticate(request);
  if (!userId) return error(401, 'Missing or invalid authentication token');
  const body = submitPaymentSchema.safeParse(await readJson(request));
  if (!body.success) return error(400, 'Invalid payment request', body.error.flatten());
  const checkout = await ownedCheckout(request.params.checkoutId, userId);
  if (!checkout) return error(404, 'Checkout not found');
  if (checkout.status !== CheckoutStatus.AWAITING_PAYMENT || checkout.cancelRequestedAt) {
    return error(409, `Checkout is not payable (status ${checkout.status})`);
  }

  // No database write here: the orchestration consumes only the first payment event
  // and ignores the rest, and the charge's idempotency key is fixed per checkout.
  // Repeated or concurrent calls therefore cannot cause a second charge.
  const event: PaymentSubmitted = { paymentToken: body.data.paymentToken };
  await df.getClient(context).raiseEvent(checkout.id, Events.paymentSubmitted, event);
  logger.info('checkout.payment.submitted', { checkoutId: checkout.id, correlationId: checkout.correlationId });
  return json(202);
}

async function cancelCheckout(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const userId = authenticate(request);
  if (!userId) return error(401, 'Missing or invalid authentication token');
  const checkoutId = request.params.checkoutId;
  const outcome = await requestCheckoutCancel(checkoutId, userId);
  if (outcome === 'not_found') return error(404, 'Checkout not found');
  if (outcome === 'too_late') return error(409, 'Checkout is already terminal');

  // The request is recorded in the database first, so a payment already in flight
  // honours it even if this event arrives after the orchestration stopped waiting.
  const checkout = (await getCheckout(checkoutId))!;
  const log = logger.child({ checkoutId, correlationId: checkout.correlationId });
  try {
    await df.getClient(context).raiseEvent(checkoutId, Events.cancelRequested, {});
  } catch (err) {
    log.warn('checkout.cancel.event_not_delivered', { err });
  }
  log.info('checkout.cancel.requested');
  return json(202);
}

const client = df.input.durableClient();

app.http('startCheckout', {
  route: 'checkouts',
  methods: ['POST'],
  authLevel: 'anonymous',
  extraInputs: [client],
  handler: startCheckout,
});
app.http('getCheckout', {
  route: 'checkouts/{checkoutId}',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: getCheckoutStatus,
});
app.http('submitCheckoutPayment', {
  route: 'checkouts/{checkoutId}/payment',
  methods: ['POST'],
  authLevel: 'anonymous',
  extraInputs: [client],
  handler: submitPayment,
});
app.http('cancelCheckout', {
  route: 'checkouts/{checkoutId}/cancel',
  methods: ['POST'],
  authLevel: 'anonymous',
  extraInputs: [client],
  handler: cancelCheckout,
});
