import { env } from '../config/env';
import { logger } from '../lib/logger';
import { releaseExpiredHolds } from '../modules/holds/holds.service';
import { processExpiredOffers } from '../modules/waitlist/waitlist.service';

// Background TTL sweeper. Every SWEEP_INTERVAL_SECONDS it releases expired seat
// holds and processes expired waitlist offers (re-offering their seats to the
// next person in line). This is the primary expiry mechanism; seat-map reads and
// hold/booking attempts also lazily expire holds as a backstop if the sweeper lags.
//
// (A pure-DB alternative would be a `pg_cron` job running the same SQL — see README.)

let timer: NodeJS.Timeout | null = null;
let running = false;

async function sweep(): Promise<void> {
  // Skip if the previous sweep is still running (avoids overlapping passes).
  if (running) return;
  running = true;
  try {
    const [holds, offers] = await Promise.all([releaseExpiredHolds(), processExpiredOffers()]);
    if (holds > 0 || offers > 0) {
      logger.info(`Sweeper: released ${holds} expired hold(s), processed ${offers} expired offer(s)`);
    }
  } catch (err) {
    logger.error('Sweeper run failed:', err);
  } finally {
    running = false;
  }
}

/** Start the periodic sweeper. Returns a stop function. */
export function startSweeper(): () => void {
  timer = setInterval(() => void sweep(), env.SWEEP_INTERVAL_SECONDS * 1000);
  timer.unref?.(); // don't keep the process alive solely for the sweeper
  logger.info(`Sweeper started (every ${env.SWEEP_INTERVAL_SECONDS}s)`);
  // Run one pass shortly after boot to clear anything left over from a restart.
  setTimeout(() => void sweep(), 1000).unref?.();
  return stopSweeper;
}

export function stopSweeper(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
