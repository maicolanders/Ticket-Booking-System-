import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db/client';
import { runInTransaction } from '../src/db/transaction';
import { lockSeats } from '../src/seats/seats';
import { createShowFixture } from './fixtures';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Hold row locks on `seatIds` in a separate transaction for `ms`. */
function holdLocks(seatIds: string[], ms: number): Promise<void> {
  return prisma.$transaction(
    async (tx) => {
      await lockSeats(tx, seatIds);
      await sleep(ms);
    },
    { timeout: ms + 5_000 },
  );
}

describe('runInTransaction', () => {
  it('serialises overlapping multi-seat locks requested in opposite orders without deadlock', async () => {
    const { showSeatIds } = await createShowFixture({ seats: 2 });
    const [a, b] = showSeatIds;
    let invocations = 0;

    const lockThenPause = (ids: string[]) =>
      runInTransaction(async (tx) => {
        invocations += 1;
        const locked = await lockSeats(tx, ids);
        await sleep(200);
        return locked.map((seat) => seat.id);
      });

    const results = await Promise.all([lockThenPause([a, b]), lockThenPause([b, a])]);

    // Both see rows in the same (primary-key) order, and neither needed a retry.
    expect(results[0]).toEqual(results[1]);
    expect(invocations).toBe(2);
  });

  it('retries after a lock timeout and succeeds once the lock is released', async () => {
    const { showSeatIds } = await createShowFixture({ seats: 1 });
    let attempts = 0;

    const holder = holdLocks(showSeatIds, 700);
    await sleep(100);
    const locked = await runInTransaction(
      async (tx) => {
        attempts += 1;
        return lockSeats(tx, showSeatIds);
      },
      { lockTimeoutMs: 300, maxAttempts: 5 },
    );
    await holder;

    expect(locked).toHaveLength(1);
    expect(attempts).toBeGreaterThan(1);
  });

  it('gives up after maxAttempts while the lock stays taken', async () => {
    const { showSeatIds } = await createShowFixture({ seats: 1 });
    let attempts = 0;

    const holder = holdLocks(showSeatIds, 2_000);
    await sleep(100);
    await expect(
      runInTransaction(
        async (tx) => {
          attempts += 1;
          return lockSeats(tx, showSeatIds);
        },
        { lockTimeoutMs: 100, maxAttempts: 3 },
      ),
    ).rejects.toMatchObject({ code: 'P2010', meta: { code: '55P03' } });
    await holder;

    expect(attempts).toBe(3);
  });

  it('does not retry business errors', async () => {
    let attempts = 0;
    await expect(
      runInTransaction(async () => {
        attempts += 1;
        throw new Error('seat already taken');
      }),
    ).rejects.toThrow('seat already taken');
    expect(attempts).toBe(1);
  });
});
