import { z } from 'zod';

// App settings (local.settings.json locally, Application Settings in Azure).
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  HOLD_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  PAYMENT_API_URL: z.string().url(),
  PAYMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  SMTP_URL: z.string().optional().default(''),
  RESEND_API_KEY: z.string().optional().default(''),
  MAIL_FROM: z.string().default('Ticket Booking <onboarding@resend.dev>'),
});

export const config = schema.parse(process.env);
