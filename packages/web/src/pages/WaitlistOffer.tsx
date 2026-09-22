import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { waitlistApi } from '../api/endpoints';
import { queryKeys } from '../lib/queryKeys';
import { apiErrorMessage } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { useToast } from '../components/toast';
import { HoldCountdown } from '../components/HoldCountdown';
import { Alert, Badge, Button, Card, Loading } from '../components/ui';
import { ClockIcon, MapPinIcon, SparklesIcon } from '../components/icons';

export default function WaitlistOffer() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [expired, setExpired] = useState(false);

  const query = useQuery({
    queryKey: queryKeys.offer(token!),
    queryFn: () => waitlistApi.getOffer(token!),
    enabled: Boolean(token),
  });

  const acceptMutation = useMutation({
    mutationFn: () => waitlistApi.acceptOffer(token!),
    onSuccess: (booking) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookings });
      navigate(`/bookings/${booking.reference}`, { replace: true, state: { justBooked: true } });
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Could not accept this offer.')),
  });

  if (query.isLoading) return <Loading />;
  if (query.isError || !query.data)
    return <Alert tone="error">This offer link is invalid or has expired.</Alert>;

  const offer = query.data;
  const isOpen = offer.status === 'PENDING' && !expired;

  return (
    <div className="mx-auto max-w-lg py-6">
      <Card className="overflow-hidden p-0">
        <div className="marquee-bulbs h-1.5" role="presentation" />

        <div className="p-6 sm:p-8">
          <div className="flex flex-col items-center text-center">
            <span className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-brass/30 bg-brass/10 px-3 py-1 text-xs font-medium text-brass-bright">
              <SparklesIcon size={14} /> A seat just opened up
            </span>
            <h1 className="font-display text-2xl font-semibold text-cream">{offer.eventTitle}</h1>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-cream-muted">
              <ClockIcon size={15} className="text-cream-dim" />
              {formatDateTime(offer.startsAt)}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-cream-muted">
              <MapPinIcon size={15} className="text-cream-dim" />
              {offer.venueName}
            </p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <Badge tone="brass">Seat {offer.seatLabel}</Badge>
              <Badge tone="neutral">{offer.categoryName}</Badge>
            </div>
          </div>

          <div className="mt-6">
            {offer.status === 'ACCEPTED' ? (
              <Alert tone="success">
                You’ve already accepted this offer.{' '}
                <Link to="/bookings" className="font-medium underline">
                  View your bookings
                </Link>
                .
              </Alert>
            ) : !isOpen ? (
              <Alert tone="warning" title="This offer expired">
                The seat was passed to the next person in line. You can re-join the waitlist from the
                show page.
              </Alert>
            ) : (
              <>
                <div className="mb-4 flex flex-col items-center gap-1 rounded-xl border border-brass/30 bg-brass/10 py-4">
                  <span className="text-xs uppercase tracking-wide text-cream-dim">
                    Claim before it’s gone
                  </span>
                  <HoldCountdown
                    expiresAt={offer.expiresAt}
                    onExpire={() => setExpired(true)}
                    className="text-3xl"
                  />
                </div>
                <Button
                  size="lg"
                  className="w-full"
                  loading={acceptMutation.isPending}
                  onClick={() => acceptMutation.mutate()}
                >
                  Accept &amp; book this seat
                </Button>
                <p className="mt-2 text-center text-xs text-cream-dim">
                  Your ticket and QR code are emailed the moment you accept.
                </p>
              </>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
