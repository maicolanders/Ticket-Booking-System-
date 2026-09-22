import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULTS, EventType, SeatStatus, type SeatMapSeatDTO } from '@ticket/shared';
import { showsApi, waitlistApi } from '../api/endpoints';
import type { CheckoutState, HeldSeatLine } from '../api/types';
import { queryKeys } from '../lib/queryKeys';
import { apiErrorMessage } from '../lib/api';
import { formatDateTime, formatMoney } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/toast';
import { useShowSocket } from '../realtime/useShowSocket';
import { SeatMap } from '../components/SeatMap';
import { SeatMapLegend } from '../components/SeatMapLegend';
import { Alert, Badge, Button, Card, Skeleton } from '../components/ui';
import { ChevronLeftIcon, MapPinIcon, TicketIcon } from '../components/icons';

const MAX_SEATS = 10;
const HOLD_MINUTES = Math.round(DEFAULTS.HOLD_TTL_SECONDS / 60);

export default function SeatSelection() {
  const { id: showId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { isAuthenticated } = useAuth();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useShowSocket(showId);

  const showQuery = useQuery({
    queryKey: queryKeys.show(showId!),
    queryFn: () => showsApi.get(showId!),
    enabled: Boolean(showId),
  });
  const seatQuery = useQuery({
    queryKey: queryKeys.seatMap(showId!),
    queryFn: () => showsApi.seats(showId!),
    enabled: Boolean(showId),
  });
  const waitlistQuery = useQuery({
    queryKey: queryKeys.myWaitlist(showId!),
    queryFn: () => showsApi.myWaitlist(showId!),
    enabled: Boolean(showId) && isAuthenticated,
  });

  const seatMap = seatQuery.data;

  // Drop any selected seat that another guest just took (via live updates).
  useEffect(() => {
    if (!seatMap) return;
    setSelectedIds((prev) => {
      const stillFree = new Set(
        seatMap.seats.filter((s) => s.status === SeatStatus.AVAILABLE && !s.heldByMe).map((s) => s.id),
      );
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (stillFree.has(id)) next.add(id);
        else changed = true;
      }
      if (changed) toast.warning('A seat you picked was just taken. Please choose another.');
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seatMap]);

  const selectedSeats = useMemo(
    () =>
      seatMap
        ? seatMap.seats
            .filter((s) => selectedIds.has(s.id))
            .sort((a, b) => a.rowLabel.localeCompare(b.rowLabel) || a.colNumber - b.colNumber)
        : [],
    [seatMap, selectedIds],
  );
  const total = selectedSeats.reduce((sum, s) => sum + s.price, 0);

  const holdMutation = useMutation({
    mutationFn: () => showsApi.createHold(showId!, [...selectedIds]),
    onSuccess: (hold) => {
      const seats: HeldSeatLine[] = selectedSeats.map((s) => ({
        id: s.id,
        label: `${s.rowLabel}${s.colNumber}`,
        categoryName: s.categoryName,
        price: s.price,
      }));
      const state: CheckoutState = {
        hold,
        seats,
        show: {
          id: showId!,
          title: showQuery.data?.event.title ?? 'Show',
          venueName: showQuery.data?.venue.name ?? '',
          startsAt: showQuery.data?.startsAt ?? hold.expiresAt,
        },
      };
      navigate('/checkout', { state });
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, 'Those seats were just taken. Please pick again.'));
      setSelectedIds(new Set());
      void queryClient.invalidateQueries({ queryKey: queryKeys.seatMap(showId!) });
    },
  });

  const waitlistMutation = useMutation({
    mutationFn: (categoryId: string) => showsApi.joinWaitlist(showId!, categoryId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.myWaitlist(showId!) });
      toast.success('You’re on the waitlist. We’ll email you the moment a seat frees up.');
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Could not join the waitlist.')),
  });

  const leaveMutation = useMutation({
    mutationFn: (entryId: string) => waitlistApi.leave(entryId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.myWaitlist(showId!) });
      toast.info('You’ve left the waitlist.');
    },
  });

  const toggleSeat = (seat: SeatMapSeatDTO) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(seat.id)) {
        next.delete(seat.id);
      } else if (next.size < MAX_SEATS) {
        next.add(seat.id);
      } else {
        toast.info(`You can hold up to ${MAX_SEATS} seats at a time.`);
      }
      return next;
    });
  };

  if (showQuery.isLoading || seatQuery.isLoading) {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Skeleton className="h-[26rem] w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }
  if (showQuery.isError || !showQuery.data || !seatMap) {
    return (
      <Alert tone="error" title="Couldn’t load this show">
        Please refresh, or{' '}
        <Link to="/browse" className="font-medium underline">
          go back to browse
        </Link>
        .
      </Alert>
    );
  }

  const show = showQuery.data;
  const screenLabel = show.event.type === EventType.CONCERT ? 'Stage' : 'Screen';
  const waitlistByCat = new Map((waitlistQuery.data ?? []).map((e) => [e.seatCategoryId, e]));
  const soldOutCategories = seatMap.categories.filter((c) =>
    seatMap.soldOutCategoryIds.includes(c.id),
  );

  const selectionSummary = (
    <>
      {selectedSeats.length === 0 ? (
        <p className="text-sm text-cream-dim">Tap available seats on the map to select them.</p>
      ) : (
        <ul className="mb-3 space-y-1.5 text-sm">
          {selectedSeats.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-cream-muted">
                <span className="font-mono text-cream">
                  {s.rowLabel}
                  {s.colNumber}
                </span>
                <Badge color={s.categoryColor}>{s.categoryName}</Badge>
              </span>
              <span className="text-cream">{formatMoney(s.price)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mb-4 flex justify-between border-t border-ink-600 pt-3 font-semibold text-cream">
        <span>Total</span>
        <span>{formatMoney(total)}</span>
      </div>
      {isAuthenticated ? (
        <Button
          className="w-full"
          disabled={selectedSeats.length === 0}
          loading={holdMutation.isPending}
          onClick={() => holdMutation.mutate()}
        >
          Hold {selectedSeats.length || ''} seat{selectedSeats.length === 1 ? '' : 's'} & continue
        </Button>
      ) : (
        <Link to="/login" state={{ from: { pathname: `/shows/${showId}` } }}>
          <Button className="w-full" variant="secondary">
            Log in to book
          </Button>
        </Link>
      )}
      <p className="mt-2 text-center text-xs text-cream-dim">
        Seats are reserved for {HOLD_MINUTES} minutes while you check out.
      </p>
    </>
  );

  return (
    <div className="pb-24 lg:pb-0">
      <Link
        to={`/events/${show.event.id}`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-cream-muted transition-colors hover:text-brass"
      >
        <ChevronLeftIcon size={16} /> {show.event.title}
      </Link>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-cream sm:text-3xl">
        {formatDateTime(show.startsAt)}
      </h1>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-cream-muted">
        <MapPinIcon size={15} className="text-cream-dim" />
        {show.venue.name} · {show.venue.address}
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card className="p-3 sm:p-5">
          <SeatMap
            seatMap={seatMap}
            selectedIds={selectedIds}
            onToggle={toggleSeat}
            disabled={holdMutation.isPending}
            screenLabel={screenLabel}
          />
        </Card>

        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card className="p-4">
            <SeatMapLegend categories={seatMap.categories} />
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 font-display text-lg font-semibold text-cream">Your seats</h2>
            {selectionSummary}
          </Card>

          {soldOutCategories.length > 0 && (
            <Card className="p-4">
              <h2 className="mb-1 font-display text-lg font-semibold text-cream">Sold out?</h2>
              <p className="mb-3 text-xs text-cream-dim">
                Join the waitlist and we’ll offer you a seat the moment one is released.
              </p>
              <div className="space-y-3">
                {soldOutCategories.map((c) => {
                  const entry = waitlistByCat.get(c.id);
                  return (
                    <div key={c.id} className="rounded-xl border border-ink-600 bg-ink-900/50 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <Badge color={c.color}>{c.name}</Badge>
                        <span className="text-xs text-cream-dim">{formatMoney(c.price)}</span>
                      </div>
                      {!isAuthenticated ? (
                        <Link to="/login" state={{ from: { pathname: `/shows/${showId}` } }}>
                          <Button size="sm" variant="secondary" className="w-full">
                            Log in to join waitlist
                          </Button>
                        </Link>
                      ) : entry?.status === 'OFFERED' && entry.offer ? (
                        <Link to={`/waitlist/offer/${entry.offer.token}`}>
                          <Button size="sm" className="w-full">
                            <TicketIcon size={15} /> A seat is yours — claim it
                          </Button>
                        </Link>
                      ) : entry?.status === 'WAITING' ? (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm text-cream-muted">
                            You’re <strong className="text-brass-bright">#{entry.position}</strong> in
                            line
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={leaveMutation.isPending}
                            onClick={() => leaveMutation.mutate(entry.id)}
                          >
                            Leave
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="w-full"
                          loading={waitlistMutation.isPending}
                          onClick={() => waitlistMutation.mutate(c.id)}
                        >
                          Join waitlist
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Mobile sticky action bar */}
      {isAuthenticated && selectedSeats.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-ink-600 bg-ink-900/95 p-3 backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-6xl items-center gap-3">
            <div className="min-w-0">
              <p className="text-xs text-cream-dim">
                {selectedSeats.length} seat{selectedSeats.length === 1 ? '' : 's'}
              </p>
              <p className="font-semibold text-cream">{formatMoney(total)}</p>
            </div>
            <Button
              className="ml-auto"
              loading={holdMutation.isPending}
              onClick={() => holdMutation.mutate()}
            >
              Hold & continue
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
