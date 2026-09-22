import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { bookingsApi, holdsApi } from '../api/endpoints';
import type { CheckoutState } from '../api/types';
import { queryKeys } from '../lib/queryKeys';
import { apiErrorMessage } from '../lib/api';
import { formatDateTime, formatMoney, formatTime } from '../lib/format';
import { useToast } from '../components/toast';
import { HoldCountdown } from '../components/HoldCountdown';
import { Alert, Badge, Button, Card, TicketPerforation } from '../components/ui';
import { ChevronLeftIcon, ClockIcon, MailIcon, MapPinIcon } from '../components/icons';

export default function Checkout() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const state = location.state as CheckoutState | null;

  const [expired, setExpired] = useState(false);

  const confirmMutation = useMutation({
    mutationFn: () => bookingsApi.create(state!.hold.id),
    onSuccess: (booking) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookings });
      void queryClient.invalidateQueries({ queryKey: queryKeys.seatMap(state!.show.id) });
      navigate(`/bookings/${booking.reference}`, { replace: true, state: { justBooked: true } });
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Could not confirm the booking.')),
  });

  const releaseMutation = useMutation({
    mutationFn: () => holdsApi.release(state!.hold.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.seatMap(state!.show.id) });
      navigate(`/shows/${state!.show.id}`, { replace: true });
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Could not release the seats.')),
  });

  // A hold can't be re-fetched by id, so a page refresh loses the flow.
  if (!state) return <Navigate to="/" replace />;

  const { hold, seats, show } = state;

  return (
    <div className="mx-auto max-w-xl">
      <Link
        to={`/shows/${show.id}`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-cream-muted transition-colors hover:text-brass"
      >
        <ChevronLeftIcon size={16} /> Back to seats
      </Link>
      <h1 className="mb-5 font-display text-2xl font-semibold tracking-tight text-cream sm:text-3xl">
        Review &amp; confirm
      </h1>

      <Card className="overflow-hidden p-0">
        {/* Upper stub — what & when */}
        <div className="p-5 sm:p-6">
          <h2 className="font-display text-xl font-semibold text-cream">{show.title}</h2>
          <p className="mt-2 flex items-center gap-1.5 text-sm text-cream-muted">
            <ClockIcon size={15} className="text-cream-dim" />
            {formatDateTime(show.startsAt)}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-cream-muted">
            <MapPinIcon size={15} className="text-cream-dim" />
            {show.venueName}
          </p>

          {!expired && (
            <div className="mt-4 flex items-center justify-between rounded-xl border border-brass/30 bg-brass/10 px-4 py-3">
              <div className="text-sm">
                <p className="font-medium text-brass-bright">Reserved for you</p>
                <p className="text-cream-dim">Held until {formatTime(hold.expiresAt)}</p>
              </div>
              <div className="text-right">
                <HoldCountdown
                  expiresAt={hold.expiresAt}
                  onExpire={() => setExpired(true)}
                  className="text-xl"
                />
                <p className="text-[11px] uppercase tracking-wide text-cream-dim">remaining</p>
              </div>
            </div>
          )}
        </div>

        <TicketPerforation className="my-0" />

        {/* Lower stub — seats & total */}
        <div className="p-5 sm:p-6">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-cream-dim">
            {seats.length} seat{seats.length === 1 ? '' : 's'}
          </p>
          <ul className="space-y-2">
            {seats.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-cream">{s.label}</span>
                  <Badge tone="neutral">{s.categoryName}</Badge>
                </span>
                <span className="text-cream">{formatMoney(s.price)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-center justify-between border-t border-ink-600 pt-4">
            <span className="font-semibold text-cream">Total</span>
            <span className="font-display text-xl font-semibold text-brass-bright">
              {formatMoney(hold.totalAmount)}
            </span>
          </div>

          <div className="mt-6 space-y-3">
            {expired ? (
              <Alert tone="warning" title="Your hold expired">
                The seats have been released.{' '}
                <Link to={`/shows/${show.id}`} className="font-medium underline">
                  Pick seats again
                </Link>
                .
              </Alert>
            ) : (
              <>
                <Button
                  className="w-full"
                  size="lg"
                  loading={confirmMutation.isPending}
                  onClick={() => confirmMutation.mutate()}
                >
                  Confirm booking · {formatMoney(hold.totalAmount)}
                </Button>
                <p className="flex items-center justify-center gap-1.5 text-center text-xs text-cream-dim">
                  <MailIcon size={14} />
                  Your ticket and QR code are emailed the moment you confirm.
                </p>
                <Button
                  variant="ghost"
                  className="w-full"
                  loading={releaseMutation.isPending}
                  onClick={() => releaseMutation.mutate()}
                >
                  Release seats &amp; go back
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
