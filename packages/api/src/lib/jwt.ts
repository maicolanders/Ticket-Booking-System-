import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { Role } from '@ticket/shared';

export interface AuthTokenPayload {
  sub: string;
  role: Role;
  email: string;
}

export const signAuthToken = (payload: AuthTokenPayload): string =>
  jwt.sign(payload, env.JWT_SECRET, { expiresIn: '7d' });

export const verifyAuthToken = (token: string): AuthTokenPayload =>
  jwt.verify(token, env.JWT_SECRET) as AuthTokenPayload;

// QR ticket token: signed so a ticket's authenticity can be verified at the gate.
export const signTicketToken = (reference: string): string =>
  jwt.sign({ ref: reference, kind: 'ticket' }, env.JWT_SECRET, { expiresIn: '365d' });

export const verifyTicketToken = (token: string): { ref: string; kind: string } =>
  jwt.verify(token, env.JWT_SECRET) as { ref: string; kind: string };
