import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SearchIcon, ChevronLeftIcon, ChevronRightIcon, ArrowRightIcon } from './icons';
import { IconButton } from './ui';

/**
 * Prominent search box. Submitting navigates to Browse with the query applied.
 * Used on the homepage hero and reused wherever a search entry point helps.
 */
export function SearchBar({
  initial = '',
  placeholder = 'Search movies, concerts, venues…',
  autoFocus,
}: {
  initial?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const navigate = useNavigate();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    navigate(q ? `/browse?q=${encodeURIComponent(q)}` : '/browse');
  };

  return (
    <form onSubmit={submit} role="search" className="relative w-full">
      <SearchIcon
        size={20}
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-cream-dim"
      />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label="Search events"
        className="w-full rounded-2xl border border-ink-600 bg-ink-800/80 py-3.5 pl-12 pr-28 text-cream shadow-card backdrop-blur placeholder:text-cream-dim focus:border-brass focus:bg-ink-800 focus:outline-none"
      />
      <button
        type="submit"
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl bg-brass px-4 py-2 text-sm font-semibold text-ink-950 transition-colors hover:bg-brass-bright"
      >
        Search
      </button>
    </form>
  );
}

export function SectionHeader({
  title,
  kicker,
  seeAllTo,
}: {
  title: ReactNode;
  kicker?: ReactNode;
  seeAllTo?: string;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        {kicker && (
          <p className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-brass">{kicker}</p>
        )}
        <h2 className="font-display text-xl font-semibold tracking-tight text-cream sm:text-2xl">
          {title}
        </h2>
      </div>
      {seeAllTo && (
        <Link
          to={seeAllTo}
          className="flex shrink-0 items-center gap-1 text-sm font-medium text-cream-muted transition-colors hover:text-brass"
        >
          See all <ArrowRightIcon size={15} />
        </Link>
      )}
    </div>
  );
}

/**
 * Horizontally-scrolling rail of cards with desktop scroll buttons.
 * Children should be fixed-width, snap-aligned items.
 */
export function Rail({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 4);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
  };

  const scrollBy = (dir: 1 | -1) => {
    ref.current?.scrollBy({ left: dir * Math.round((ref.current.clientWidth || 320) * 0.8), behavior: 'smooth' });
  };

  return (
    <div className="group/rail relative">
      <div
        ref={ref}
        onScroll={onScroll}
        className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-1 pb-1"
      >
        {children}
      </div>

      {!atStart && (
        <div className="pointer-events-none absolute -left-3 top-0 hidden h-full items-center md:flex">
          <IconButton
            label="Scroll left"
            variant="secondary"
            onClick={() => scrollBy(-1)}
            className="pointer-events-auto rounded-full shadow-pop"
          >
            <ChevronLeftIcon size={18} />
          </IconButton>
        </div>
      )}
      {!atEnd && (
        <div className="pointer-events-none absolute -right-3 top-0 hidden h-full items-center md:flex">
          <IconButton
            label="Scroll right"
            variant="secondary"
            onClick={() => scrollBy(1)}
            className="pointer-events-auto rounded-full shadow-pop"
          >
            <ChevronRightIcon size={18} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
