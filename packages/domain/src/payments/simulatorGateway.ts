import {
  PaymentRejectedError,
  TransientPaymentError,
  type ChargeOutcome,
  type ChargeRequest,
  type PaymentGateway,
  type RefundRequest,
} from './payments';

export interface SimulatorGatewayConfig {
  baseUrl: string;
  /** Must exceed the provider's slowest processing time: it does not dedupe in-flight requests. */
  timeoutMs: number;
}

interface ProviderResponse {
  status: number;
  body: { id?: string; amount?: number; error?: { code?: string } };
}

const errorCode = (response: ProviderResponse) => response.body.error?.code ?? `http_${response.status}`;

/** Adapter for the payment simulator's HTTP API (packages/payment-sim). */
export class SimulatorPaymentGateway implements PaymentGateway {
  constructor(private readonly config: SimulatorGatewayConfig) {}

  async charge(request: ChargeRequest): Promise<ChargeOutcome> {
    let response: ProviderResponse;
    try {
      response = await this.send('POST', '/v1/charges', request, {
        amount: request.amountMinor,
        currency: request.currency,
        paymentToken: request.paymentToken,
        metadata: request.metadata,
      });
    } catch (error) {
      // No response: the charge may or may not exist. Ask the provider instead of guessing.
      return this.resolveUnknownCharge(request, error);
    }

    if (response.status === 201) return charged(response);
    if (response.status === 402) return { kind: 'declined', reason: errorCode(response) };
    throw classify(response, 'charge');
  }

  async refund(request: RefundRequest): Promise<void> {
    let response: ProviderResponse;
    try {
      response = await this.send('POST', '/v1/refunds', request, { chargeId: request.chargeId });
    } catch (error) {
      // Repeating with the same key replays a processed refund, so no lookup is needed.
      throw new TransientPaymentError('Refund outcome unknown', { cause: error });
    }

    if (response.status === 201) return;
    // Refunded already (e.g. by an earlier attempt under another key): the goal is met.
    if (response.status === 409 && errorCode(response) === 'charge_already_refunded') return;
    throw classify(response, 'refund');
  }

  private async resolveUnknownCharge(request: ChargeRequest, cause: unknown): Promise<ChargeOutcome> {
    let lookup: ProviderResponse;
    try {
      const query = new URLSearchParams({ idempotencyKey: request.idempotencyKey });
      lookup = await this.send('GET', `/v1/charges?${query}`, request);
    } catch {
      throw new TransientPaymentError('Charge outcome unknown and lookup failed', { cause });
    }
    if (lookup.status === 200) return charged(lookup);
    // Not recorded: repeating the charge with the same key cannot double-charge.
    throw new TransientPaymentError('Charge outcome unknown; no charge recorded', { cause });
  }

  private async send(
    method: 'GET' | 'POST',
    path: string,
    keys: { idempotencyKey: string; correlationId: string },
    body?: unknown,
  ): Promise<ProviderResponse> {
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'idempotency-key': keys.idempotencyKey,
        'x-correlation-id': keys.correlationId,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  }
}

function charged(response: ProviderResponse): ChargeOutcome {
  const { id, amount } = response.body;
  if (typeof id !== 'string' || typeof amount !== 'number') {
    throw new TransientPaymentError('Malformed charge response');
  }
  return { kind: 'charged', chargeId: id, amountMinor: amount };
}

function classify(response: ProviderResponse, operation: string): Error {
  const code = errorCode(response);
  if (response.status >= 500 || response.status === 429) {
    return new TransientPaymentError(`${operation} failed transiently: ${code}`);
  }
  return new PaymentRejectedError(code, `${operation} rejected: ${code}`);
}
