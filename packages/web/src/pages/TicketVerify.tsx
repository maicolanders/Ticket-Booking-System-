import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { TicketVerifyDTO } from '@ticket/shared';
import { ticketsApi } from '../api/endpoints';
import { apiErrorMessage } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Alert, Badge, Button, Card, Field, PageTitle, Textarea } from '../components/ui';
import { CheckCircleIcon, XIcon } from '../components/icons';

function Result({ result }: { result: TicketVerifyDTO }) {
  const ok = result.valid;
  return (
    <Card className={ok ? 'border-success/50 p-5' : 'border-rose/50 p-5'}>
      <div className="mb-3 flex items-center gap-2.5">
        <span
          className={`grid h-9 w-9 place-items-center rounded-full ${
            ok ? 'bg-success/15 text-success' : 'bg-rose/15 text-rose-bright'
          }`}
        >
          {ok ? <CheckCircleIcon size={20} /> : <XIcon size={20} />}
        </span>
        <span className={`font-display text-lg font-semibold ${ok ? 'text-success' : 'text-rose-bright'}`}>
          {ok ? 'Valid ticket' : 'Not valid'}
        </span>
      </div>
      {result.reason && <p className="mb-3 text-sm text-cream-muted">{result.reason}</p>}
      {result.reference && (
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-cream-dim">Reference</dt>
            <dd className="font-mono text-cream">{result.reference}</dd>
          </div>
          {result.eventTitle && (
            <div className="flex justify-between gap-4">
              <dt className="text-cream-dim">Event</dt>
              <dd className="text-cream">{result.eventTitle}</dd>
            </div>
          )}
          {result.startsAt && (
            <div className="flex justify-between gap-4">
              <dt className="text-cream-dim">Showtime</dt>
              <dd className="text-cream">{formatDateTime(result.startsAt)}</dd>
            </div>
          )}
          {result.customerName && (
            <div className="flex justify-between gap-4">
              <dt className="text-cream-dim">Customer</dt>
              <dd className="text-cream">{result.customerName}</dd>
            </div>
          )}
          {result.seats && result.seats.length > 0 && (
            <div className="flex items-center justify-between gap-4">
              <dt className="text-cream-dim">Seats</dt>
              <dd className="flex flex-wrap justify-end gap-1">
                {result.seats.map((s) => (
                  <Badge key={s} tone="brass">
                    {s}
                  </Badge>
                ))}
              </dd>
            </div>
          )}
        </dl>
      )}
    </Card>
  );
}

export default function TicketVerify() {
  const [token, setToken] = useState('');

  const mutation = useMutation({
    mutationFn: () => ticketsApi.verify(token.trim()),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (token.trim()) mutation.mutate();
  };

  return (
    <div className="mx-auto max-w-lg">
      <PageTitle title="Verify ticket" subtitle="Paste the token encoded in a ticket’s QR code." />
      <Card className="mb-4 p-5">
        <form onSubmit={submit} className="space-y-3">
          <Field label="Scanned QR token" htmlFor="token">
            <Textarea
              id="token"
              rows={4}
              className="font-mono text-xs"
              placeholder="eyJhbGciOi…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </Field>
          <Button type="submit" className="w-full" loading={mutation.isPending} disabled={!token.trim()}>
            Verify
          </Button>
        </form>
      </Card>

      {mutation.isError && <Alert tone="error">{apiErrorMessage(mutation.error)}</Alert>}
      {mutation.data && <Result result={mutation.data} />}
    </div>
  );
}
