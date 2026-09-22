import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import type { AuthUserDTO, LoginInput, RegisterInput, Role } from '@ticket/shared';
import { authApi } from '../api/endpoints';
import { setUnauthorizedHandler, tokenStore } from '../lib/api';
import { useToast } from '../components/toast';

interface AuthState {
  user: AuthUserDTO | null;
  token: string | null;
}

interface AuthContextValue extends AuthState {
  isAuthenticated: boolean;
  hasRole: (...roles: Role[]) => boolean;
  login: (input: LoginInput) => Promise<AuthUserDTO>;
  register: (input: RegisterInput) => Promise<AuthUserDTO>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [state, setState] = useState<AuthState>(() => ({
    token: tokenStore.get(),
    user: tokenStore.getUser() as AuthUserDTO | null,
  }));

  const apply = useCallback((token: string, user: AuthUserDTO) => {
    tokenStore.set(token, user);
    setState({ token, user });
    return user;
  }, []);

  const login = useCallback(
    async (input: LoginInput) => {
      const res = await authApi.login(input);
      return apply(res.token, res.user);
    },
    [apply],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const res = await authApi.register(input);
      return apply(res.token, res.user);
    },
    [apply],
  );

  const logout = useCallback(() => {
    tokenStore.clear();
    setState({ token: null, user: null });
  }, []);

  // When any authenticated request comes back 401, the session has expired.
  // The api layer has already cleared the token; here we reset state, let the
  // user know, and send them to sign in again.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setState({ token: null, user: null });
      toast.info('Your session has expired. Please sign in again.');
      navigate('/login');
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate, toast]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      isAuthenticated: Boolean(state.token && state.user),
      hasRole: (...roles: Role[]) => (state.user ? roles.includes(state.user.role) : false),
      login,
      register,
      logout,
    }),
    [state, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
