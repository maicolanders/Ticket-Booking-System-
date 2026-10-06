import { Resend } from 'resend';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Logger } from '../observability/logger';

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

/**
 * Mail port. send() throws on failure so callers decide whether to retry or swallow.
 * `log` lets a caller bind its own context (e.g. a checkout's correlation id) to the delivery line.
 */
export interface Mailer {
  send(input: MailInput, log?: Logger): Promise<void>;
}

export interface MailerConfig {
  from: string;
  resendApiKey?: string;
  smtpUrl?: string;
  log: Logger;
}

/**
 * Resend when an API key is set, otherwise SMTP (Mailpit locally), otherwise an
 * Ethereal sandbox inbox whose preview URL is logged.
 */
export function createMailer(config: MailerConfig): Mailer {
  const resend = config.resendApiKey ? new Resend(config.resendApiKey) : null;
  const smtp = !resend && config.smtpUrl ? nodemailer.createTransport(config.smtpUrl) : null;
  let ethereal: Promise<Transporter> | null = null;

  const etherealTransport = () =>
    (ethereal ??= nodemailer.createTestAccount().then((account) => {
      config.log.info('mail.transport.ethereal', { reason: 'RESEND_API_KEY and SMTP_URL are not set' });
      return nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: { user: account.user, pass: account.pass },
      });
    }));

  return {
    async send(input, log = config.log) {
      const attachments = input.attachments?.map((a) => ({ filename: a.filename, content: a.content }));
      if (resend) {
        const { error } = await resend.emails.send({ from: config.from, ...input, attachments });
        if (error) throw new Error(`Resend rejected the email: ${JSON.stringify(error)}`);
        log.info('mail.sent', { transport: 'resend', to: input.to, subject: input.subject });
        return;
      }
      const transport = smtp ?? (await etherealTransport());
      const info = await transport.sendMail({ from: config.from, ...input, attachments });
      const preview = smtp ? false : nodemailer.getTestMessageUrl(info);
      log.info('mail.sent', {
        transport: smtp ? 'smtp' : 'ethereal',
        to: input.to,
        subject: input.subject,
        ...(preview ? { preview } : {}),
      });
    },
  };
}
