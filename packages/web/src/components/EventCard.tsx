import { Link } from 'react-router-dom';
import { EventType } from '@ticket/shared';
import type { EventListItem } from '../api/types';
import { formatDateTime, formatMoneyRange } from '../lib/format';
import { Badge } from './ui';
import { CalendarIcon, FilmIcon, MusicIcon, TicketIcon } from './icons';

function TypeBadge({ type }: { type: EventType }) {
  const isMovie = type === EventType.MOVIE;
  return (
    <Badge tone="brass">
      {isMovie ? <FilmIcon size={13} /> : <MusicIcon size={13} />}
      {isMovie ? 'Movie' : 'Concert'}
    </Badge>
  );
}

export function EventCard({ event }: { event: EventListItem }) {
  return (
    <Link
      to={`/events/${event.id}`}
      className="group block overflow-hidden rounded-2xl border border-ink-600 bg-ink-800 shadow-card transition-all hover:-translate-y-0.5 hover:border-ink-500 hover:shadow-pop"
    >
      <div className="relative aspect-[3/2] w-full overflow-hidden bg-ink-700">
        {event.imageUrl ? (
          <img
            src={event.imageUrl}
            alt=""
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="grid h-full place-items-center text-ink-500">
            <TicketIcon size={40} />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950/85 via-ink-950/10 to-transparent" />
        <div className="absolute left-3 top-3">
          <TypeBadge type={event.type} />
        </div>
        <h3 className="absolute inset-x-3 bottom-2.5 line-clamp-2 font-display text-lg font-semibold leading-tight text-cream drop-shadow">
          {event.title}
        </h3>
      </div>

      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2 text-xs text-cream-dim">
          {event.genre && <span className="truncate">{event.genre}</span>}
          {event.genre && <span aria-hidden="true">·</span>}
          <span className="truncate">{event.organiserName}</span>
        </div>
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-1.5 text-cream-muted">
            <CalendarIcon size={14} className="text-cream-dim" />
            {event.nextShowAt ? formatDateTime(event.nextShowAt) : 'Coming soon'}
          </span>
          <span className="shrink-0 font-medium text-cream">
            {formatMoneyRange(event.minPrice, event.maxPrice)}
          </span>
        </div>
      </div>
    </Link>
  );
}
