import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { BookingDTO } from '@ticket/shared';
import { bookingsApi } from '../api/endpoints';
import { queryKeys } from '../lib/queryKeys';
import { formatDateTime, formatMoney } from '../lib/format';
import { Alert, Badge, Card, EmptyState, Loading, PageTitle } from '../components/ui';
import { ArrowRightIcon, CalendarIcon, MapPinIcon, TicketIcon } from '../components/icons';

function StatusBadge({ status }: { status: BookingDTO['status'] }) {
  return status === 'CONFIRMED' ? (
    <Badge tone="success">Confirmed</Badge>
  ) : (
    <Badge tone="neutral">Cancelled</Badge>
  );
}

export default function BookingHistory() {
  const query = useQuery({ queryKey: queryKeys.bookings, queryFn: () => bookingsApi.list() });

  if (query.isLoading) return <Loading />;
  if (query.isError) return <Alert tone="error">Couldn’t load your bookings.</Alert>;
  const bookings = query.data ?? [];

  return (
    <div>
      <PageTitle title="My bookings" subtitle="Your tickets and booking history." />
      {bookings.length === 0 ? (
        <EmptyState
          title="No bookings yet"
          icon={<TicketIcon size={22} />}
          action={
            <Link
              to="/browse"
              className="inline-flex items-center gap-1.5 font-medium text-brass transition-colors hover:text-brass-bright"
            >
              Browse events <ArrowRightIcon size={16} />
            </Link>
          }
        >
          When you book a seat, your ticket and QR code will appear here.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => {
            const cancelled = b.status === 'CANCELLED';
            return (
              <Link key={b.id} to={`/bookings/${b.reference}`} className="block">
                <Card interactive className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className={cancelled ? 'opacity-60' : undefined}>
                      <div className="flex items-center gap-2">
                        <h3 className="font-display text-lg font-semibold text-cream">
                          {b.show.eventTitle}
                        </h3>
                        <StatusBadge status={b.status} />
                      </div>
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-cream-muted">
                        <CalendarIcon size={14} className="text-cream-dim" />
                        {formatDateTime(b.show.startsAt)}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-sm text-cream-muted">
                        <MapPinIcon size={14} className="text-cream-dim" />
                        {b.show.venueName}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {b.seats.map((s, i) => (
                          <Badge key={i} tone="brass">
                            {s.rowLabel}
                            {s.colNumber}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-cream">{formatMoney(b.totalAmount)}</p>
                      <p className="mt-1 font-mono text-xs text-cream-dim">{b.reference}</p>
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
