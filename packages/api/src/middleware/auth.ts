import type { RequestHandler } from 'express';
import { verifyAuthToken } from '../lib/jwt';
import { unauthorized, forbidden } from '../lib/errors';
import type { Role } from '@ticket/shared';

export interface AuthedUser {
  id: string;
  role: Role;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

function extractUser(req: { headers: { authorization?: string } }): AuthedUser | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const payload = verifyAuthToken(header.slice('Bearer '.length));
    return { id: payload.sub, role: payload.role, email: payload.email };
  } catch {
    return null;
  }
}

/** Reject the request unless a valid bearer token is present. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const user = extractUser(req);
  if (!user) return next(unauthorized('Missing or invalid authentication token'));
  req.user = user;
  next();
};

/** Attach req.user if a valid token is present, but allow anonymous access. */
export const optionalAuth: RequestHandler = (req, _res, next) => {
  const user = extractUser(req);
  if (user) req.user = user;
  next();
};

/** Require the authenticated user to have one of the given roles. */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden('You do not have access to this resource'));
    next();
  };
