import 'dotenv/config';
import { z } from 'zod';
import { DEFAULT_JWT_SECRET } from '@ticket/domain';

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PORT: z.coerce.number().default(4000),
  JWT_SECRET: z.string().min(1).default(DEFAULT_JWT_SECRET),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  APP_BASE_URL: z.string().default('http://localhost:5173'),
  HOLD_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  WAITLIST_OFFER_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  SWEEP_INTERVAL_SECONDS: z.coerce.number().int().positive().default(15),
  RESEND_API_KEY: z.string().optional().default(''),
  SMTP_URL: z.string().optional().default(''),
  MAIL_FROM: z.string().default('Ticket Booking <onboarding@resend.dev>'),
  PAYMENT_API_URL: z.string().url().default('http://localhost:4100'),
  PAYMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export const isProd = env.NODE_ENV === 'production';

export const corsOrigins = env.CORS_ORIGIN.split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (isProd && env.JWT_SECRET === DEFAULT_JWT_SECRET) {
  // eslint-disable-next-line no-console
  console.warn('[WARN] JWT_SECRET is using the insecure default in production. Set a strong secret.');
}
