import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Role } from '@ticket/shared';
import { useAuth } from './AuthContext';

/**
 * Guards a route: requires authentication, and optionally one of `roles`.
 * Redirects to /login (preserving the intended path) when signed out, or to /
 * when signed in but lacking the required role.
 */
export function RequireAuth({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (roles && user && !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
