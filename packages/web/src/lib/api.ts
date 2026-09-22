import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:4000';

const TOKEN_KEY = 'ticket_token';
const USER_KEY = 'ticket_user';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  getUser: () => {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  },
  set: (token: string, user: unknown) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

export const api = axios.create({ baseURL: `${API_BASE}/api` });

api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/* ---------------------------------------------------------------------------
 * Automatic session-expiry handling.
 * AuthContext registers a handler; when a request made *with* a token comes
 * back 401, the token is stale — we clear it and let the app bounce to login.
 * Login/register 401s are the user's own bad credentials, not an expiry, so
 * they're excluded and handled inline by those forms.
 * ------------------------------------------------------------------------ */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

const AUTH_PATHS = ['/auth/login', '/auth/register'];

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const url = err.config?.url ?? '';
      const isAuthAttempt = AUTH_PATHS.some((p) => url.includes(p));
      if (status === 401 && tokenStore.get() && !isAuthAttempt) {
        tokenStore.clear();
        onUnauthorized?.();
      }
    }
    return Promise.reject(err);
  },
);

/** Human-readable fallbacks per HTTP status when the server sends no message. */
const STATUS_MESSAGES: Record<number, string> = {
  400: 'Please check the details and try again.',
  401: 'Please sign in to continue.',
  403: "You don't have permission to do that.",
  404: "We couldn't find what you were looking for.",
  409: 'Those seats were just taken. Please choose different ones.',
  410: 'This hold or offer has expired.',
  422: 'Some of the details need fixing before we can continue.',
  429: 'Too many attempts. Please wait a moment and try again.',
  500: 'Something went wrong on our end. Please try again.',
  503: 'The service is temporarily unavailable. Please try again shortly.',
};

/** Pull a human-readable message out of an axios error. */
export function apiErrorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  if (axios.isAxiosError(err)) {
    // A request that never reached the server (offline, CORS, server down).
    if (!err.response) {
      return 'Cannot reach the server. Check your connection and try again.';
    }
    const data = err.response.data as { error?: string; message?: string } | undefined;
    const serverMsg = data?.error ?? data?.message;
    if (serverMsg) return serverMsg;
    return STATUS_MESSAGES[err.response.status] ?? fallback;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
