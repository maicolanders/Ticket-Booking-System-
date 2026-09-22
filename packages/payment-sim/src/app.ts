import express, { type Request, type Response } from 'express';
import { z } from 'zod';

const chargeSchema = z.object({
  amount: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  paymentToken: z.string().min(1),
  metadata: z.record(z.string()).optional().default({}),
});
const refundSchema = z.object({ chargeId: z.string().min(1) });
const faultsSchema = z.object({
  latencyMs: z.number().int().nonnegative().optional(),
  errorRate: z.number().min(0).max(1).optional(),
  hang: z.boolean().optional(),
});

type ChargeInput = z.infer<typeof chargeSchema>;
type Faults = z.infer<typeof faultsSchema>;

interface CorrelationHeaders {
  correlationId: string | null;
  traceparent: string | null;
}

interface Charge extends ChargeInput, CorrelationHeaders {
  id: string;
  status: 'succeeded';
  createdAt: string;
  idempotencyKey: string;
  refunded: boolean;
}

interface Refund extends CorrelationHeaders {
  id: string;
  chargeId: string;
  amount: number;
  status: 'succeeded';
  idempotencyKey: string;
}

interface StoredResponse {
  fingerprint: string;
  status: number;
  body: unknown;
}

export interface RequestEntry extends CorrelationHeaders {
  timestamp: string;
  method: string;
  path: string;
  idempotencyKey: string | null;
  token: string | null;
  responseStatus: number;
}

export interface SimulatorOptions {
  seed?: number;
  slowMs?: number;
  hangMs?: number;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function headers(req: Request): CorrelationHeaders {
  return {
    correlationId: req.header('X-Correlation-Id') ?? null,
    traceparent: req.header('traceparent') ?? null,
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createPaymentSimulator(options: SimulatorOptions = {}) {
  const app = express();
  const charges: Charge[] = [];
  const refunds: Refund[] = [];
  const requests: RequestEntry[] = [];
  const responses = new Map<string, StoredResponse>();
  const fingerprints = new Map<string, string>();
  const attempts = new Map<string, number>();
  let faults: Faults = {};
  let chargeSequence = 0;
  let refundSequence = 0;
  let randomState = options.seed ?? Number(process.env.SIM_SEED ?? 1);
  const slowMs = options.slowMs ?? Number(process.env.SIM_SLOW_MS ?? 5000);
  const hangMs = options.hangMs ?? Number(process.env.SIM_HANG_MS ?? 60000);

  function random(): number {
    randomState = (randomState * 1664525 + 1013904223) >>> 0;
    return randomState / 0x1_0000_0000;
  }

  app.use(express.json());
  app.use((req, res, next) => {
    const correlationId = req.header('X-Correlation-Id');
    if (correlationId) res.setHeader('X-Correlation-Id', correlationId);
    const entry: RequestEntry = {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      idempotencyKey: req.header('Idempotency-Key') ?? null,
      token:
        req.body && typeof req.body === 'object' && typeof req.body.paymentToken === 'string'
          ? req.body.paymentToken
          : null,
      ...headers(req),
      responseStatus: 0,
    };
    let recorded = false;
    const record = () => {
      if (recorded) return;
      recorded = true;
      entry.responseStatus = res.statusCode;
      requests.push(entry);
      process.stdout.write(`${JSON.stringify({ ...entry, outcome: res.statusCode })}\n`);
    };
    res.once('finish', record);
    res.once('close', record);
    next();
  });

  function requireKey(req: Request, res: Response): string | null {
    const key = req.header('Idempotency-Key');
    if (!key) {
      res.status(400).json({ error: { code: 'idempotency_key_required' } });
      return null;
    }
    return key;
  }

  function checkKey(key: string, path: string, body: unknown, res: Response): StoredResponse | null | false {
    const fingerprint = stableStringify({ path, body });
    const previousFingerprint = fingerprints.get(key);
    if (previousFingerprint && previousFingerprint !== fingerprint) {
      res.status(409).json({ error: { code: 'idempotency_key_reuse' } });
      return false;
    }
    fingerprints.set(key, fingerprint);
    const stored = responses.get(key);
    return stored ?? null;
  }

  function store(key: string, path: string, body: unknown, status: number, responseBody: unknown): void {
    responses.set(key, { fingerprint: stableStringify({ path, body }), status, body: responseBody });
  }

  async function applyFaults(): Promise<'error' | 'hang' | null> {
    if (faults.latencyMs) await wait(faults.latencyMs);
    if (faults.errorRate && random() < faults.errorRate) return 'error';
    return faults.hang ? 'hang' : null;
  }

  async function sendOrHang(res: Response, status: number, body: unknown, hang: boolean): Promise<void> {
    res.status(status);
    if (!hang) {
      res.json(body);
      return;
    }
    await wait(hangMs);
    res.socket?.destroy();
  }

  app.post('/v1/charges', async (req, res) => {
    const key = requireKey(req, res);
    if (!key) return;
    const parsed = chargeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'validation_error', details: parsed.error.flatten() } });
      return;
    }
    const replay = checkKey(key, req.path, parsed.data, res);
    if (replay === false) return;
    if (replay) {
      res.status(replay.status).json(replay.body);
      return;
    }

    const fault = await applyFaults();
    if (fault === 'error') {
      res.status(503).json({ error: { code: 'service_unavailable' } });
      return;
    }
    const attempt = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, attempt);
    if (parsed.data.paymentToken === 'tok_decline') {
      const body = { error: { code: 'card_declined' } };
      store(key, req.path, parsed.data, 402, body);
      res.status(402).json(body);
      return;
    }
    if (parsed.data.paymentToken === 'tok_flaky' && attempt <= 2) {
      res.status(503).json({ error: { code: 'service_unavailable' } });
      return;
    }
    if (parsed.data.paymentToken === 'tok_slow') await wait(slowMs);

    const charge: Charge = {
      id: `ch_${String(++chargeSequence).padStart(6, '0')}`,
      status: 'succeeded',
      ...parsed.data,
      createdAt: new Date().toISOString(),
      idempotencyKey: key,
      refunded: false,
      ...headers(req),
    };
    charges.push(charge);
    const body = {
      id: charge.id,
      status: charge.status,
      amount: charge.amount,
      currency: charge.currency,
      metadata: charge.metadata,
      createdAt: charge.createdAt,
    };
    store(key, req.path, parsed.data, 201, body);
    await sendOrHang(res, 201, body, fault === 'hang' || parsed.data.paymentToken === 'tok_timeout');
  });

  app.get('/v1/charges/:id', (req, res) => {
    const charge = charges.find((item) => item.id === req.params.id);
    if (!charge) {
      res.status(404).json({ error: { code: 'charge_not_found' } });
      return;
    }
    res.json(charge);
  });

  app.get('/v1/charges', (req, res) => {
    const key = typeof req.query.idempotencyKey === 'string' ? req.query.idempotencyKey : '';
    const charge = charges.find((item) => item.idempotencyKey === key);
    if (!charge) {
      res.status(404).json({ error: { code: 'charge_not_found' } });
      return;
    }
    res.json(charge);
  });

  app.post('/v1/refunds', async (req, res) => {
    const key = requireKey(req, res);
    if (!key) return;
    const parsed = refundSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'validation_error', details: parsed.error.flatten() } });
      return;
    }
    const replay = checkKey(key, req.path, parsed.data, res);
    if (replay === false) return;
    if (replay) {
      res.status(replay.status).json(replay.body);
      return;
    }
    const charge = charges.find((item) => item.id === parsed.data.chargeId);
    if (!charge) {
      res.status(404).json({ error: { code: 'charge_not_found' } });
      return;
    }
    if (charge.refunded) {
      res.status(409).json({ error: { code: 'charge_already_refunded' } });
      return;
    }
    const fault = await applyFaults();
    if (fault === 'error') {
      res.status(503).json({ error: { code: 'service_unavailable' } });
      return;
    }
    charge.refunded = true;
    const refund: Refund = {
      id: `re_${String(++refundSequence).padStart(6, '0')}`,
      chargeId: charge.id,
      amount: charge.amount,
      status: 'succeeded',
      idempotencyKey: key,
      ...headers(req),
    };
    refunds.push(refund);
    const body = { id: refund.id, chargeId: refund.chargeId, amount: refund.amount, status: refund.status };
    store(key, req.path, parsed.data, 201, body);
    await sendOrHang(res, 201, body, fault === 'hang');
  });

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/__admin/ledger', (_req, res) => res.json({ charges, refunds }));
  app.get('/__admin/requests', (_req, res) => res.json(requests));
  app.post('/__admin/reset', (_req, res) => {
    charges.length = 0;
    refunds.length = 0;
    requests.length = 0;
    responses.clear();
    fingerprints.clear();
    attempts.clear();
    faults = {};
    chargeSequence = 0;
    refundSequence = 0;
    res.status(204).end();
  });
  app.post('/__admin/faults', (req, res) => {
    const parsed = faultsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'validation_error', details: parsed.error.flatten() } });
      return;
    }
    faults = parsed.data;
    res.json(faults);
  });
  app.delete('/__admin/faults', (_req, res) => {
    faults = {};
    res.status(204).end();
  });

  return app;
}
