import { createMailer, type MailInput } from '@ticket/domain';
import { env } from '../config/env';
import { logger } from './logger';

/** Throws on failure: for deliveries that must not be recorded unless they went out. */
export const mailer = createMailer({
  from: env.MAIL_FROM,
  resendApiKey: env.RESEND_API_KEY,
  smtpUrl: env.SMTP_URL,
  log: logger,
});

/**
 * Send an email from the API. Never throws outside production, so a mail outage
 * never blocks a booking in dev (the checkout saga retries delivery instead).
 */
export async function sendMail(input: MailInput): Promise<void> {
  try {
    await mailer.send(input);
  } catch (err) {
    logger.error('mail.failed', { to: input.to, subject: input.subject, err });
    if (env.NODE_ENV === 'production') throw err;
  }
}
