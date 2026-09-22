import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { EventType } from '@ticket/shared';
import { eventsApi } from '../api/endpoints';
import { queryKeys } from '../lib/queryKeys';
import type { EventListItem } from '../api/types';
import { EventCard } from '../components/EventCard';
import { Rail, SearchBar, SectionHeader } from '../components/discovery';
import { Alert, Button, EmptyState, Skeleton } from '../components/ui';
import { ArrowRightIcon, FilmIcon, MusicIcon, TicketIcon } from '../components/icons';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function RailCard({ children }: { children: React.ReactNode }) {
  return <div className="w-[248px] shrink-0 snap-start sm:w-[264px]">{children}</div>;
}

function SkeletonRail() {
  return (
    <div className="flex gap-4 overflow-hidden">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="w-[248px] shrink-0 sm:w-[264px]">
          <Skeleton className="aspect-[3/2] w-full rounded-2xl" />
          <Skeleton className="mt-3 h-4 w-3/4" />
          <Skeleton className="mt-2 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

function EventRail({ title, kicker, events }: { title: string; kicker?: string; events: EventListItem[] }) {
  if (events.length === 0) return null;
  return (
    <section>
      <SectionHeader title={title} kicker={kicker} seeAllTo="/browse" />
      <Rail>
        {events.map((e) => (
          <RailCard key={e.id}>
            <EventCard event={e} />
          </RailCard>
        ))}
      </Rail>
    </section>
  );
}

function Hero({ featured }: { featured?: EventListItem }) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-ink-600 bg-ink-900">
      {featured?.imageUrl && (
        <img
          src={featured.imageUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-[2px]"
        />
      )}
      <div className="absolute inset-0 bg-hero-glow" aria-hidden="true" />
      <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/70 to-ink-950/30" aria-hidden="true" />

      <div className="relative px-6 py-14 sm:px-10 sm:py-20">
        <div className="max-w-2xl">
          <div className="marquee-bulbs mb-5" aria-hidden="true">
            <span /> <span /> <span /> <span /> <span /> <span />
          </div>
          <h1 className="font-display text-4xl font-semibold leading-[1.05] tracking-tight text-cream sm:text-6xl">
            The best seats,
            <br />
            <span className="text-brass">before they’re gone.</span>
          </h1>
          <p className="mt-4 max-w-lg text-base text-cream-muted sm:text-lg">
            Pick your seats on a live map, hold them while you decide, and get a QR ticket in your
            inbox. Movies and live events, booked in seconds.
          </p>

          <div className="mt-7 max-w-xl">
            <SearchBar />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link to={`/browse?type=${EventType.MOVIE}`}>
              <Button variant="secondary" size="sm">
                <FilmIcon size={16} /> Movies
              </Button>
            </Link>
            <Link to={`/browse?type=${EventType.CONCERT}`}>
              <Button variant="secondary" size="sm">
                <MusicIcon size={16} /> Concerts
              </Button>
            </Link>
            {featured && (
              <Link to={`/events/${featured.id}`}>
                <Button variant="ghost" size="sm">
                  Now showing: {featured.title} <ArrowRightIcon size={15} />
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const query = useQuery({
    queryKey: queryKeys.events({ home: 'all' }),
    queryFn: () => eventsApi.list({}),
  });

  const events = useMemo(() => query.data ?? [], [query.data]);

  const rails = useMemo(() => {
    const withShows = events.filter((e) => e.nextShowAt);
    const byDate = [...withShows].sort(
      (a, b) => new Date(a.nextShowAt!).getTime() - new Date(b.nextShowAt!).getTime(),
    );
    const now = Date.now();
    return {
      featured: byDate[0] ?? events[0],
      trending: [...events].sort((a, b) => b.showCount - a.showCount).slice(0, 10),
      movies: events.filter((e) => e.type === EventType.MOVIE).slice(0, 10),
      concerts: events.filter((e) => e.type === EventType.CONCERT).slice(0, 10),
      thisWeek: byDate
        .filter((e) => new Date(e.nextShowAt!).getTime() - now <= WEEK_MS)
        .slice(0, 10),
    };
  }, [events]);

  return (
    <div className="space-y-10">
      <Hero featured={rails.featured} />

      {query.isError ? (
        <Alert tone="error" title="Couldn’t load events">
          Please refresh the page, or try again in a moment.
        </Alert>
      ) : query.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-7 w-40" />
          <SkeletonRail />
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          title="No events yet"
          icon={<TicketIcon size={22} />}
          action={
            <Link to="/browse">
              <Button>Browse everything</Button>
            </Link>
          }
        >
          Check back soon — new movies and concerts are added regularly.
        </EmptyState>
      ) : (
        <>
          <EventRail title="Trending now" kicker="What everyone’s booking" events={rails.trending} />
          <EventRail title="This week" kicker="Happening soon" events={rails.thisWeek} />
          <EventRail title="Now showing" kicker="Movies" events={rails.movies} />
          <EventRail title="Live & upcoming" kicker="Concerts" events={rails.concerts} />
        </>
      )}
    </div>
  );
}
