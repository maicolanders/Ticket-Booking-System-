import jwt from 'jsonwebtoken';
import type { Role } from '@ticket/shared';

export const DEFAULT_JWT_SECRET = 'dev-secret-change-me';

// Read lazily so importing the domain never races the host's .env loading
// (the API loads dotenv in its config module; Functions injects app settings).
const secret = (): string => process.env.JWT_SECRET || DEFAULT_JWT_SECRET;

export interface AuthTokenPayload {
  sub: string;
  role: Role;
  email: string;
}

export const signAuthToken = (payload: AuthTokenPayload): string =>
  jwt.sign(payload, secret(), { expiresIn: '7d' });

export const verifyAuthToken = (token: string): AuthTokenPayload =>
  jwt.verify(token, secret()) as AuthTokenPayload;

// QR ticket token: signed so a ticket's authenticity can be verified at the gate.
export const signTicketToken = (reference: string): string =>
  jwt.sign({ ref: reference, kind: 'ticket' }, secret(), { expiresIn: '365d' });

export const verifyTicketToken = (token: string): { ref: string; kind: string } =>
  jwt.verify(token, secret()) as { ref: string; kind: string };
