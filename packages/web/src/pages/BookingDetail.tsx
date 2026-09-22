import { Link, useLocation, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookingDTO } from '@ticket/shared';
import { bookingsApi } from '../api/endpoints';
import { queryKeys } from '../lib/queryKeys';
import { apiErrorMessage } from '../lib/api';
import { formatDateTime, formatMoney } from '../lib/format';
import { useToast } from '../components/toast';
import { Alert, Badge, Button, Card, Loading, TicketPerforation } from '../components/ui';
import {
  CalendarPlusIcon,
  ChevronLeftIcon,
  ClockIcon,
  MapPinIcon,
} from '../components/icons';

/** Build a Google Calendar "add event" link so customers can save the show. */
function googleCalendarUrl(booking: BookingDTO): string {
  const toStamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const start = new Date(booking.show.startsAt);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000); // assume ~2h
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: booking.show.eventTitle,
    dates: `${toStamp(start.toISOString())}/${toStamp(end.toISOString())}`,
    location: booking.show.venueName,
    details: `Booking reference ${booking.reference}`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export default function BookingDetail() {
  const { reference } = useParams<{ reference: string }>();
  const location = useLocation();
  const queryClient = useQueryClient();
  const toast = useToast();
  const justBooked = (location.state as { justBooked?: boolean } | null)?.justBooked;

  const query = useQuery({
    queryKey: queryKeys.booking(reference!),
    queryFn: () => bookingsApi.get(reference!),
    enabled: Boolean(reference),
  });

  const cancelMutation = useMutation({
    mutationFn: () => bookingsApi.cancel(query.data!.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.booking(reference!) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookings });
      toast.info('Booking cancelled. Your seats have been released.');
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Could not cancel this booking.')),
  });

  if (query.isLoading) return <Loading />;
  if (query.isError || !query.data) return <Alert tone="error">Booking not found.</Alert>;
  const booking = query.data;
  const cancelled = booking.status === 'CANCELLED';
  const seatCount = booking.seats.length;
  const admit = seatCount === 1 ? 'ADMIT ONE' : `ADMIT ${seatCount}`;

  return (
    <div className="mx-auto max-w-md">
      <Link
        to="/bookings"
        className="mb-3 inline-flex items-center gap-1 text-sm text-cream-muted transition-colors hover:text-brass"
      >
        <ChevronLeftIcon size={16} /> All bookings
      </Link>

      {justBooked && (
        <div className="mb-4">
          <Alert tone="success" title="You’re in!">
            A QR ticket has been emailed to you. Show it at the gate.
          </Alert>
        </div>
      )}
      {cancelled && (
        <div className="mb-4">
          <Alert tone="info">This booking was cancelled and the seats have been released.</Alert>
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <div className="marquee-bulbs h-1.5" role="presentation" />

        <div className="p-6 sm:p-8">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-[0.3em] text-brass">{admit}</span>
            <Badge tone={cancelled ? 'neutral' : 'success'}>
              {cancelled ? 'Cancelled' : 'Confirmed'}
            </Badge>
          </div>

          <h1 className="mt-3 font-display text-2xl font-semibold leading-tight text-cream">
            {booking.show.eventTitle}
          </h1>
          <p className="mt-2 flex items-center gap-1.5 text-sm text-cream-muted">
            <ClockIcon size={15} className="text-cream-dim" />
            {formatDateTime(booking.show.startsAt)}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-cream-muted">
            <MapPinIcon size={15} className="text-cream-dim" />
            {booking.show.venueName}
          </p>

          {/* QR sits on a light panel so gate scanners read it reliably */}
          <div className="mt-6 flex flex-col items-center">
            {booking.qrDataUrl ? (
              <div className="rounded-2xl bg-cream p-3 shadow-pop">
                <img
                  src={booking.qrDataUrl}
                  alt={`QR ticket ${booking.reference}`}
                  className={cancelled ? 'h-44 w-44 opacity-30 grayscale' : 'h-44 w-44'}
                />
              </div>
            ) : (
              <div className="grid h-44 w-44 place-items-center rounded-2xl bg-ink-700 text-cream-dim">
                No QR
              </div>
            )}
            <p className="mt-3 font-mono text-lg font-semibold tracking-wide text-cream">
              {booking.reference}
            </p>
            <p className="text-xs text-cream-dim">Scan this at the entrance</p>
          </div>
        </div>

        <TicketPerforation className="my-0" />

        <div className="p-6 sm:p-8">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-cream-dim">
            Seat{seatCount === 1 ? '' : 's'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {booking.seats.map((s, i) => (
              <Badge key={i} tone="brass">
                {s.rowLabel}
                {s.colNumber} · {s.categoryName} · {formatMoney(s.price)}
              </Badge>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-ink-600 pt-4">
            <span className="font-semibold text-cream">Total paid</span>
            <span className="font-semibold text-cream">{formatMoney(booking.totalAmount)}</span>
          </div>

          {!cancelled && (
            <div className="mt-6 space-y-3">
              <a href={googleCalendarUrl(booking)} target="_blank" rel="noreferrer" className="block">
                <Button variant="secondary" className="w-full">
                  <CalendarPlusIcon size={17} /> Add to calendar
                </Button>
              </a>
              <Button
                variant="danger"
                className="w-full"
                loading={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate()}
              >
                Cancel booking
              </Button>
              <p className="text-center text-xs text-cream-dim">
                Cancelling frees your seats and offers them to the next person on the waitlist.
              </p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
