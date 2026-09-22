import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { EventType, type EventFilterInput } from '@ticket/shared';
import { eventsApi } from '../api/endpoints';
import { queryKeys } from '../lib/queryKeys';
import type { EventListItem } from '../api/types';
import { EventCard } from '../components/EventCard';
import {
  Alert,
  Button,
  Chip,
  EmptyState,
  Input,
  Modal,
  PageTitle,
  SegmentedControl,
  Select,
  Skeleton,
} from '../components/ui';
import { SearchIcon, SlidersIcon } from '../components/icons';

type SortKey = 'soon' | 'price-asc' | 'price-desc' | 'az';

const SORT_LABELS: Record<SortKey, string> = {
  soon: 'Soonest',
  'price-asc': 'Price: low to high',
  'price-desc': 'Price: high to low',
  az: 'Title: A–Z',
};

function sortEvents(events: EventListItem[], sort: SortKey): EventListItem[] {
  const copy = [...events];
  switch (sort) {
    case 'soon':
      return copy.sort((a, b) => {
        if (!a.nextShowAt) return 1;
        if (!b.nextShowAt) return -1;
        return new Date(a.nextShowAt).getTime() - new Date(b.nextShowAt).getTime();
      });
    case 'price-asc':
      return copy.sort((a, b) => (a.minPrice ?? Infinity) - (b.minPrice ?? Infinity));
    case 'price-desc':
      return copy.sort((a, b) => (b.maxPrice ?? -Infinity) - (a.maxPrice ?? -Infinity));
    case 'az':
      return copy.sort((a, b) => a.title.localeCompare(b.title));
  }
}

function FilterControls({
  type,
  onType,
  sort,
  onSort,
  genres,
  genre,
  onGenre,
}: {
  type: string;
  onType: (t: string) => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  genres: string[];
  genre: string;
  onGenre: (g: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          value={type}
          onChange={onType}
          options={[
            { value: '', label: 'All' },
            { value: EventType.MOVIE, label: 'Movies' },
            { value: EventType.CONCERT, label: 'Concerts' },
          ]}
        />
        <Select
          aria-label="Sort by"
          value={sort}
          onChange={(e) => onSort(e.target.value as SortKey)}
          className="w-auto"
        >
          {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
            <option key={k} value={k}>
              {SORT_LABELS[k]}
            </option>
          ))}
        </Select>
      </div>

      {genres.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Chip active={genre === ''} onClick={() => onGenre('')}>
            All genres
          </Chip>
          {genres.map((g) => (
            <Chip key={g} active={genre === g} onClick={() => onGenre(genre === g ? '' : g)}>
              {g}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Browse() {
  const [params, setParams] = useSearchParams();
  const urlType = params.get('type') ?? '';
  const urlQuery = params.get('q') ?? '';

  const [searchInput, setSearchInput] = useState(urlQuery);
  const [debounced, setDebounced] = useState(urlQuery);
  const [sort, setSort] = useState<SortKey>('soon');
  const [genre, setGenre] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Debounce the free-text search, then reflect it in the URL (shareable).
  useEffect(() => {
    const id = setTimeout(() => setDebounced(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    const next = new URLSearchParams(params);
    if (debounced) next.set('q', debounced);
    else next.delete('q');
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const setType = (t: string) => {
    const next = new URLSearchParams(params);
    if (t) next.set('type', t);
    else next.delete('type');
    setParams(next, { replace: true });
  };

  const filter: EventFilterInput = useMemo(() => {
    const f: EventFilterInput = {};
    if (urlType) f.type = urlType as EventType;
    if (debounced) f.search = debounced;
    return f;
  }, [urlType, debounced]);

  const query = useQuery({
    queryKey: queryKeys.events(filter as Record<string, string | undefined>),
    queryFn: () => eventsApi.list(filter),
    placeholderData: (prev) => prev,
  });

  const allEvents = query.data ?? [];
  const genres = useMemo(
    () => [...new Set(allEvents.map((e) => e.genre).filter(Boolean))].sort(),
    [allEvents],
  );
  const results = useMemo(() => {
    const filtered = genre ? allEvents.filter((e) => e.genre === genre) : allEvents;
    return sortEvents(filtered, sort);
  }, [allEvents, genre, sort]);

  const hasActiveFilters = Boolean(urlType || debounced || genre);
  const clearAll = () => {
    setSearchInput('');
    setGenre('');
    setSort('soon');
    setParams(new URLSearchParams(), { replace: true });
  };

  const controlProps = {
    type: urlType,
    onType: setType,
    sort,
    onSort: setSort,
    genres,
    genre,
    onGenre: setGenre,
  };

  return (
    <div>
      <PageTitle
        title="Browse events"
        subtitle="Search the full lineup and book seats from a live map."
      />

      {/* Search + filter entry */}
      <div className="mb-5 flex gap-3">
        <div className="relative flex-1">
          <SearchIcon
            size={18}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-cream-dim"
          />
          <Input
            type="search"
            className="pl-10"
            placeholder="Search movies, concerts, venues…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search events"
          />
        </div>
        <Button variant="secondary" className="sm:hidden" onClick={() => setFiltersOpen(true)}>
          <SlidersIcon size={16} /> Filters
        </Button>
      </div>

      {/* Desktop filters inline */}
      <div className="mb-6 hidden sm:block">
        <FilterControls {...controlProps} />
      </div>

      {/* Result summary */}
      <div className="mb-4 flex items-center justify-between gap-3 text-sm text-cream-dim">
        <span aria-live="polite">
          {query.isLoading
            ? 'Searching…'
            : `${results.length} ${results.length === 1 ? 'event' : 'events'}`}
          {debounced && !query.isLoading && <> for “{debounced}”</>}
        </span>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            Clear filters
          </Button>
        )}
      </div>

      {query.isError ? (
        <Alert tone="error" title="Couldn’t load events">
          Please try again in a moment.
        </Alert>
      ) : query.isLoading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="aspect-[3/2] w-full rounded-2xl" />
              <Skeleton className="mt-3 h-4 w-3/4" />
              <Skeleton className="mt-2 h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : results.length === 0 ? (
        <EmptyState
          title="No events match your search"
          icon={<SearchIcon size={22} />}
          action={
            hasActiveFilters ? (
              <Button variant="secondary" onClick={clearAll}>
                Clear filters
              </Button>
            ) : undefined
          }
        >
          Try a different search term or remove some filters.
        </EmptyState>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}

      {/* Mobile filter drawer */}
      <Modal open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters" size="sm">
        <FilterControls {...controlProps} />
        <div className="mt-6 flex gap-3">
          {hasActiveFilters && (
            <Button variant="ghost" className="flex-1" onClick={clearAll}>
              Clear
            </Button>
          )}
          <Button className="flex-1" onClick={() => setFiltersOpen(false)}>
            Show {results.length} {results.length === 1 ? 'event' : 'events'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
