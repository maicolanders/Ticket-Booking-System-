import { Resend } from 'resend';
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from './logger';

export interface MailAttachment {
  filename: string;
  content: Buffer;
}

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  attachments?: MailAttachment[];
}

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;
const smtpTransport = !resend && env.SMTP_URL ? nodemailer.createTransport(env.SMTP_URL) : null;

// Dev fallback: Ethereal captures email in a throwaway inbox and prints a preview URL.
let etherealTransport: Transporter | null = null;
async function getEtherealTransport(): Promise<Transporter> {
  if (!etherealTransport) {
    const testAccount = await nodemailer.createTestAccount();
    etherealTransport = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    logger.info('mail.transport.ethereal', { reason: 'RESEND_API_KEY and SMTP_URL are not set' });
  }
  return etherealTransport;
}

/**
 * Send an email. Uses Resend when RESEND_API_KEY is set, otherwise an Ethereal
 * sandbox inbox in development (logs a preview URL). Never throws in dev so the
 * booking flow is not blocked by email issues.
 */
export async function sendMail(input: MailInput): Promise<void> {
  try {
    if (resend) {
      const { error } = await resend.emails.send({
        from: env.MAIL_FROM,
        to: input.to,
        subject: input.subject,
        html: input.html,
        attachments: input.attachments?.map((a) => ({ filename: a.filename, content: a.content })),
      });
      if (error) throw new Error(typeof error === 'string' ? error : JSON.stringify(error));
      logger.info('mail.sent', { transport: 'resend', to: input.to, subject: input.subject });
      return;
    }

    const transport = smtpTransport ?? (await getEtherealTransport());
    const info = await transport.sendMail({
      from: env.MAIL_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      attachments: input.attachments?.map((a) => ({ filename: a.filename, content: a.content })),
    });
    const preview = smtpTransport ? null : nodemailer.getTestMessageUrl(info);
    logger.info('mail.sent', {
      transport: preview ? 'ethereal' : 'smtp',
      to: input.to,
      subject: input.subject,
      ...(preview ? { preview } : {}),
    });
  } catch (err) {
    logger.error('mail.failed', { to: input.to, subject: input.subject, err });
    // Swallow in dev so a mail outage never blocks booking confirmation.
    if (env.NODE_ENV === 'production') throw err;
  }
}
