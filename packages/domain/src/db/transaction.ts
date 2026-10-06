import { Prisma } from '@prisma/client';
import { prisma } from './client';

export type Tx = Prisma.TransactionClient;

export interface TransactionOptions {
  /** Max wait for a row lock before PostgreSQL aborts with 55P03. */
  lockTimeoutMs?: number;
  /** Total attempts, including the first one. */
  maxAttempts?: number;
}

const DEFAULTS = { lockTimeoutMs: 2_000, statementTimeoutMs: 5_000, maxAttempts: 3 } as const;
const BACKOFF_BASE_MS = 50;

// SQLSTATEs where PostgreSQL has rolled the whole transaction back, so running
// it again from the start is safe: serialization failure, deadlock, lock timeout.
const RETRYABLE_SQLSTATES = new Set(['40001', '40P01', '55P03']);

export function isRetryableTransactionError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  // P2034: Prisma's own "write conflict or deadlock" mapping.
  if (error.code === 'P2034') return true;
  // P2010: a raw query failed; the SQLSTATE is in meta.code.
  const sqlState = (error.meta as { code?: unknown } | undefined)?.code;
  return error.code === 'P2010' && typeof sqlState === 'string' && RETRYABLE_SQLSTATES.has(sqlState);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `work` in a READ COMMITTED transaction with bounded lock and statement
 * timeouts, retrying from scratch on deadlock, serialization failure, or lock
 * timeout. Pessimistic row locks (see lockSeats) provide the isolation we need;
 * the timeouts turn a stuck lock into a fast, retryable error instead of a hang.
 */
export async function runInTransaction<T>(
  work: (tx: Tx) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULTS.lockTimeoutMs;
  const maxAttempts = options.maxAttempts ?? DEFAULTS.maxAttempts;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT set_config('lock_timeout', ${`${lockTimeoutMs}ms`}, true),
                                    set_config('statement_timeout', ${`${DEFAULTS.statementTimeoutMs}ms`}, true)`;
          return work(tx);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: 5_000,
          timeout: 10_000,
        },
      );
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableTransactionError(error)) throw error;
      // Exponential backoff with full jitter so contending callers spread out.
      await sleep(Math.random() * BACKOFF_BASE_MS * 2 ** attempt);
    }
  }
}

/**
 * The database's clock, as of the current transaction. Every expiry decision uses
 * it, so the API and the Functions app agree on "expired" whatever their clock skew.
 */
export async function dbNow(tx: Tx): Promise<Date> {
  const [row] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT now() AS now`;
  return row.now;
}
