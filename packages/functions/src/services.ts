import { SimulatorPaymentGateway, createMailer } from '@ticket/domain';
import { config } from './config';
import { logger } from './logger';

// Composition root: the Functions app's adapters, wired once from app settings.

export { logger };

export const paymentGateway = new SimulatorPaymentGateway({
  baseUrl: config.PAYMENT_API_URL,
  timeoutMs: config.PAYMENT_TIMEOUT_MS,
});

export const mailer = createMailer({
  from: config.MAIL_FROM,
  smtpUrl: config.SMTP_URL,
  resendApiKey: config.RESEND_API_KEY,
  log: logger,
});
