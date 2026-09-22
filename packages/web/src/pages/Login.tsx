import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiErrorMessage } from '../lib/api';
import { Alert, Button, Card, Field, Input } from '../components/ui';

interface LocationState {
  from?: { pathname: string };
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const dest = (location.state as LocationState | null)?.from?.pathname ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login({ email, password });
      navigate(dest, { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, 'Login failed. Please check your details and try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-6">
      <div className="mb-6 text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-cream">
          Welcome back
        </h1>
        <p className="mt-2 text-sm text-cream-muted">
          Log in to book seats and manage your tickets.
        </p>
      </div>

      <Card className="p-6 sm:p-8">
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              value={email}
              autoComplete="email"
              autoFocus
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input
              id="password"
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={submitting}>
            Log in
          </Button>
        </form>
      </Card>

      <p className="mt-5 text-center text-sm text-cream-muted">
        New here?{' '}
        <Link to="/register" className="font-medium text-brass transition-colors hover:text-brass-bright">
          Create an account
        </Link>
      </p>
    </div>
  );
}
