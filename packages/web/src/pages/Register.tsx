import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Role } from '@ticket/shared';
import { useAuth } from '../auth/AuthContext';
import { apiErrorMessage } from '../lib/api';
import { Alert, Button, Card, Field, Input, SegmentedControl } from '../components/ui';

type SignupRole = 'CUSTOMER' | 'ORGANISER';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<SignupRole>(Role.CUSTOMER);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register({ name, email, password, role });
      navigate('/', { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, 'Registration failed. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-6">
      <div className="mb-6 text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-cream">
          Create your account
        </h1>
        <p className="mt-2 text-sm text-cream-muted">
          Book seats as a customer, or host your own events as an organiser.
        </p>
      </div>

      <Card className="p-6 sm:p-8">
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}

          <Field label="I want to…" htmlFor="role">
            <SegmentedControl<SignupRole>
              className="w-full"
              value={role}
              onChange={setRole}
              options={[
                { value: Role.CUSTOMER, label: 'Book tickets' },
                { value: Role.ORGANISER, label: 'Host events' },
              ]}
            />
          </Field>

          <Field label="Name" htmlFor="name">
            <Input id="name" value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              value={email}
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Password" htmlFor="password" hint="At least 8 characters.">
            <Input
              id="password"
              type="password"
              value={password}
              autoComplete="new-password"
              minLength={8}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={submitting}>
            Create account
          </Button>
        </form>
      </Card>

      <p className="mt-5 text-center text-sm text-cream-muted">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-brass transition-colors hover:text-brass-bright">
          Log in
        </Link>
      </p>
    </div>
  );
}
