import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TERMINAL_CHECKOUT_STATUSES, type CheckoutStatus, type CheckoutStatusDTO } from '@ticket/shared';
import { checkoutsApi } from '../api/endpoints';
import type { CheckoutPageState } from '../api/types';
import { queryKeys } from '../lib/queryKeys';
import { apiErrorMessage } from '../lib/api';
import { formatDateTime, formatMoney, formatTime } from '../lib/format';
import { useToast } from '../components/toast';
import { HoldCountdown } from '../components/HoldCountdown';
import { Alert, Badge, Button, Card, Loading, SegmentedControl, Spinner, TicketPerforation } from '../components/ui';
import { ChevronLeftIcon, ClockIcon, MailIcon, MapPinIcon } from '../components/icons';

/** Simulator test cards, so every branch of the checkout saga can be tried from the UI. */
const TEST_CARDS = [
  { value: 'tok_ok', label: 'Valid' },
  { value: 'tok_decline', label: 'Declined' },
  { value: 'tok_flaky', label: 'Flaky' },
  { value: 'tok_slow', label: 'Slow' },
] as const;
type TestCard = (typeof TEST_CARDS)[number]['value'];

/** What a terminal (or unexpected) outcome means for the customer. */
const OUTCOMES: Partial<Record<CheckoutStatus, { tone: 'warning' | 'error' | 'info'; title: string; body: string }>> = {
  REJECTED: { tone: 'warning', title: 'Those seats were just taken', body: 'Someone else got there first.' },
  EXPIRED: { tone: 'warning', title: 'Your hold expired', body: 'The seats have been released.' },
  CANCELLED: { tone: 'info', title: 'Checkout cancelled', body: 'The seats are released and you were not charged.' },
  PAYMENT_DECLINED: { tone: 'error', title: 'Payment declined', body: 'Your card was not charged. The seats are released.' },
  REFUNDED: { tone: 'warning', title: 'Payment refunded', body: 'We could not complete the booking, so the charge was refunded.' },
  FAILED: { tone: 'error', title: 'Something went wrong', body: 'Our team has been alerted and will resolve your payment.' },
};

const isTerminal = (status: CheckoutStatus) => TERMINAL_CHECKOUT_STATUSES.includes(status);

export default function Checkout() {
  const { checkoutId } = useParams<{ checkoutId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const page = location.state as CheckoutPageState | null;
  const [card, setCard] = useState<TestCard>('tok_ok');

  // The saga runs server-side; poll its status until it settles.
  const statusQuery = useQuery({
    queryKey: queryKeys.checkout(checkoutId!),
    queryFn: () => checkoutsApi.status(checkoutId!),
    refetchInterval: (query) => (query.state.data && isTerminal(query.state.data.status) ? false : 1000),
  });
  const checkout = statusQuery.data;

  useEffect(() => {
    if (!checkout || !isTerminal(checkout.status)) return;
    if (page) void queryClient.invalidateQueries({ queryKey: queryKeys.seatMap(page.show.id) });
    if (checkout.status === 'CONFIRMED' && checkout.bookingReference) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookings });
      navigate(`/bookings/${checkout.bookingReference}`, { replace: true, state: { justBooked: true } });
    }
  }, [checkout, page, navigate, queryClient]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.checkout(checkoutId!) });
  const payMutation = useMutation({
    mutationFn: () => checkoutsApi.pay(checkoutId!, card),
    onSuccess: refresh,
    onError: (err) => toast.error(apiErrorMessage(err, 'Could not submit the payment.')),
  });
  const cancelMutation = useMutation({
    mutationFn: () => checkoutsApi.cancel(checkoutId!),
    onSuccess: refresh,
    onError: (err) => toast.error(apiErrorMessage(err, 'Could not cancel the checkout.')),
  });

  if (statusQuery.isPending) return <Loading label="Loading your checkout…" />;
  if (statusQuery.isError || !checkout) {
    return (
      <Alert tone="error" title="Checkout not found">
        {apiErrorMessage(statusQuery.error, 'We could not load this checkout.')}{' '}
        <Link to="/" className="font-medium underline">
          Back home
        </Link>
      </Alert>
    );
  }

  const backTo = page ? `/shows/${page.show.id}` : '/';
  const amount = checkout.amountDue === null ? null : checkout.amountDue / 100;

  return (
    <div className="mx-auto max-w-xl">
      <Link
        to={backTo}
        className="mb-3 inline-flex items-center gap-1 text-sm text-cream-muted transition-colors hover:text-brass"
      >
        <ChevronLeftIcon size={16} /> Back to seats
      </Link>
      <h1 className="mb-5 font-display text-2xl font-semibold tracking-tight text-cream sm:text-3xl">
        Review &amp; pay
      </h1>

      <Card className="overflow-hidden p-0">
        <div className="p-5 sm:p-6">
          {page ? (
            <>
              <h2 className="font-display text-xl font-semibold text-cream">{page.show.title}</h2>
              {page.show.startsAt && (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-cream-muted">
                  <ClockIcon size={15} className="text-cream-dim" />
                  {formatDateTime(page.show.startsAt)}
                </p>
              )}
              <p className="mt-1 flex items-center gap-1.5 text-sm text-cream-muted">
                <MapPinIcon size={15} className="text-cream-dim" />
                {page.show.venueName}
              </p>
            </>
          ) : (
            <h2 className="font-display text-xl font-semibold text-cream">Your checkout</h2>
          )}
          <StatusBanner checkout={checkout} />
        </div>

        <TicketPerforation className="my-0" />

        <div className="p-5 sm:p-6">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-cream-dim">
            {checkout.seatIds.length} seat{checkout.seatIds.length === 1 ? '' : 's'}
          </p>
          {page && (
            <ul className="space-y-2">
              {page.seats.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-cream">{s.label}</span>
                    <Badge tone="neutral">{s.categoryName}</Badge>
                  </span>
                  <span className="text-cream">{formatMoney(s.price)}</span>
                </li>
              ))}
            </ul>
          )}
          {amount !== null && (
            <div className="mt-4 flex items-center justify-between border-t border-ink-600 pt-4">
              <span className="font-semibold text-cream">Total</span>
              <span className="font-display text-xl font-semibold text-brass-bright">{formatMoney(amount)}</span>
            </div>
          )}

          <div className="mt-6 space-y-3">
            {checkout.status === 'AWAITING_PAYMENT' && (
              <>
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-cream-dim">Test card</p>
                  <SegmentedControl options={[...TEST_CARDS]} value={card} onChange={setCard} />
                </div>
                <Button
                  className="w-full"
                  size="lg"
                  loading={payMutation.isPending}
                  onClick={() => payMutation.mutate()}
                >
                  Pay {amount !== null && formatMoney(amount)}
                </Button>
                <p className="flex items-center justify-center gap-1.5 text-center text-xs text-cream-dim">
                  <MailIcon size={14} />
                  Your ticket and QR code are emailed once payment succeeds.
                </p>
              </>
            )}
            {(checkout.status === 'AWAITING_PAYMENT' || checkout.status === 'PROCESSING_PAYMENT') &&
              !checkout.bookingReference && (
                <Button
                  variant="ghost"
                  className="w-full"
                  loading={cancelMutation.isPending}
                  onClick={() => cancelMutation.mutate()}
                >
                  Cancel &amp; release seats
                </Button>
              )}
            <Outcome checkout={checkout} backTo={backTo} />
          </div>
        </div>
      </Card>
    </div>
  );
}

function StatusBanner({ checkout }: { checkout: CheckoutStatusDTO }) {
  if (checkout.status === 'AWAITING_PAYMENT' && checkout.holdExpiresAt) {
    return (
      <div className="mt-4 flex items-center justify-between rounded-xl border border-brass/30 bg-brass/10 px-4 py-3">
        <div className="text-sm">
          <p className="font-medium text-brass-bright">Reserved for you</p>
          <p className="text-cream-dim">Held until {formatTime(checkout.holdExpiresAt)}</p>
        </div>
        <div className="text-right">
          <HoldCountdown expiresAt={checkout.holdExpiresAt} className="text-xl" />
          <p className="text-[11px] uppercase tracking-wide text-cream-dim">remaining</p>
        </div>
      </div>
    );
  }
  const working =
    checkout.status === 'PENDING'
      ? 'Reserving your seats…'
      : checkout.status === 'PROCESSING_PAYMENT'
        ? checkout.bookingReference
          ? 'Payment received — issuing your ticket…'
          : 'Processing your payment…'
        : checkout.status === 'CONFIRMED'
          ? 'Confirmed — opening your booking…'
          : null;
  if (!working) return null;
  return (
    <div className="mt-4 flex items-center gap-3 rounded-xl border border-ink-600 bg-ink-700 px-4 py-3 text-sm text-cream-muted">
      <Spinner className="h-4 w-4" />
      {working}
    </div>
  );
}

function Outcome({ checkout, backTo }: { checkout: CheckoutStatusDTO; backTo: string }) {
  const outcome = OUTCOMES[checkout.status];
  if (!outcome) return null;
  return (
    <Alert tone={outcome.tone} title={outcome.title}>
      {outcome.body}{' '}
      <Link to={backTo} className="font-medium underline">
        Pick seats again
      </Link>
      .
    </Alert>
  );
}
