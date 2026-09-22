import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { EventType } from '@ticket/shared';
import { eventsApi } from '../api/endpoints';
import { queryKeys } from '../lib/queryKeys';
import { dayKey, formatDayHeading, formatMoney, formatTime } from '../lib/format';
import type { ShowInEvent } from '../api/types';
import { Alert, Badge, Button, Card, Skeleton } from '../components/ui';
import {
  ArrowRightIcon,
  ChevronLeftIcon,
  ClockIcon,
  FilmIcon,
  MapPinIcon,
  MusicIcon,
} from '../components/icons';

type Availability = { tone: 'success' | 'warning' | 'rose'; label: string; pct: number; soldOut: boolean };

function availabilityOf(show: ShowInEvent): Availability {
  if (show.soldOut || show.availableSeats <= 0) {
    return { tone: 'rose', label: 'Sold out', pct: 0, soldOut: true };
  }
  const pct = show.totalSeats ? show.availableSeats / show.totalSeats : 0;
  if (pct <= 0.1) return { tone: 'rose', label: `Only ${show.availableSeats} left`, pct, soldOut: false };
  if (pct <= 0.3) return { tone: 'warning', label: `${show.availableSeats} seats left`, pct, soldOut: false };
  return { tone: 'success', label: `${show.availableSeats} seats`, pct, soldOut: false };
}

const barColor: Record<Availability['tone'], string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  rose: 'bg-rose',
};

function ShowtimeCard({ show }: { show: ShowInEvent }) {
  const av = availabilityOf(show);
  const fromPrice = show.pricing.length ? Math.min(...show.pricing.map((p) => p.price)) : null;

  return (
    <Card interactive className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ClockIcon size={18} className="text-brass" />
            <p className="font-display text-lg font-semibold text-cream">{formatTime(show.startsAt)}</p>
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 text-sm text-cream-muted">
            <MapPinIcon size={15} className="shrink-0 text-cream-dim" />
            <span className="truncate">
              {show.venue.name} · {show.venue.address}
            </span>
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {show.pricing.map((p) => (
              <Badge key={p.seatCategoryId} color={p.color}>
                {p.name} · {formatMoney(p.price)}
              </Badge>
            ))}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <Badge tone={av.tone === 'rose' ? 'rose' : av.tone === 'warning' ? 'warning' : 'success'}>
            {av.label}
          </Badge>
          <Link to={`/shows/${show.id}`}>
            <Button variant={av.soldOut ? 'secondary' : 'primary'} size="sm">
              {av.soldOut ? 'Join waitlist' : 'Select seats'}
              {!av.soldOut && <ArrowRightIcon size={15} />}
            </Button>
          </Link>
          {fromPrice != null && !av.soldOut && (
            <span className="text-xs text-cream-dim">from {formatMoney(fromPrice)}</span>
          )}
        </div>
      </div>

      {!av.soldOut && show.totalSeats > 0 && (
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
          <div
            className={`h-full rounded-full ${barColor[av.tone]}`}
            style={{ width: `${Math.max(4, Math.round(av.pct * 100))}%` }}
          />
        </div>
      )}
    </Card>
  );
}

function DetailSkeleton() {
  return (
    <div>
      <Skeleton className="h-64 w-full rounded-3xl sm:h-80" />
      <Skeleton className="mt-6 h-6 w-40" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

export default function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const query = useQuery({
    queryKey: queryKeys.event(id!),
    queryFn: () => eventsApi.get(id!),
    enabled: Boolean(id),
  });

  const groups = useMemo(() => {
    if (!query.data) return [];
    const map = new Map<string, { heading: string; shows: ShowInEvent[] }>();
    for (const s of [...query.data.shows].sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    )) {
      const k = dayKey(s.startsAt);
      if (!map.has(k)) map.set(k, { heading: formatDayHeading(s.startsAt), shows: [] });
      map.get(k)!.shows.push(s);
    }
    return [...map.values()];
  }, [query.data]);

  if (query.isLoading) return <DetailSkeleton />;
  if (query.isError || !query.data) {
    return (
      <Alert tone="error" title="Event not found">
        We couldn’t find this event.{' '}
        <Link to="/browse" className="font-medium underline">
          Back to browse
        </Link>
        .
      </Alert>
    );
  }

  const event = query.data;
  const isMovie = event.type === EventType.MOVIE;

  return (
    <div>
      <Link
        to="/browse"
        className="mb-4 inline-flex items-center gap-1 text-sm text-cream-muted transition-colors hover:text-brass"
      >
        <ChevronLeftIcon size={16} /> Browse
      </Link>

      {/* Cinematic hero */}
      <div className="relative overflow-hidden rounded-3xl border border-ink-600 bg-ink-900">
        {event.imageUrl ? (
          <img src={event.imageUrl} alt="" className="h-64 w-full object-cover sm:h-80" />
        ) : (
          <div className="grid h-64 w-full place-items-center text-ink-500 sm:h-80">
            {isMovie ? <FilmIcon size={56} /> : <MusicIcon size={56} />}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/55 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8">
          <div className="mb-2.5 flex flex-wrap gap-2">
            <Badge tone="brass">
              {isMovie ? <FilmIcon size={13} /> : <MusicIcon size={13} />}
              {isMovie ? 'Movie' : 'Concert'}
            </Badge>
            {event.genre && <Badge>{event.genre}</Badge>}
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-cream drop-shadow sm:text-5xl">
            {event.title}
          </h1>
          <p className="mt-2 text-sm text-cream-muted">Presented by {event.organiser.name}</p>
        </div>
      </div>

      {event.description && (
        <p className="mt-6 max-w-3xl leading-relaxed text-cream-muted">{event.description}</p>
      )}

      {/* Showtimes */}
      <h2 className="mb-4 mt-8 font-display text-2xl font-semibold tracking-tight text-cream">
        Showtimes
      </h2>
      {groups.length === 0 ? (
        <Alert tone="info" title="No shows scheduled yet">
          Showtimes for this event haven’t been announced. Check back soon.
        </Alert>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.heading}>
              <h3 className="mb-2.5 text-sm font-semibold uppercase tracking-wider text-brass">
                {g.heading}
              </h3>
              <div className="space-y-3">
                {g.shows.map((show) => (
                  <ShowtimeCard key={show.id} show={show} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
