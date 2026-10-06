import { app } from '@azure/functions';
import { expireAbandonedCheckouts } from '@ticket/domain';
import { config } from '../config';
import { logger } from '../logger';

// Every minute, expire checkouts whose orchestration should have expired them but
// did not (lost history, e.g. the in-memory DTS emulator restarted). The grace
// period keeps it from ever racing a live orchestration's own hold timer.
app.timer('recoverAbandonedCheckouts', {
  schedule: '0 * * * * *',
  handler: async () => {
    const expired = await expireAbandonedCheckouts(config.CHECKOUT_RECOVERY_GRACE_SECONDS);
    for (const checkout of expired) {
      logger.warn('checkout.recovered.expired', {
        checkoutId: checkout.id,
        correlationId: checkout.correlationId,
        reason: 'orchestration did not expire the hold',
      });
    }
  },
});
