import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { CreateShowInput } from '@ticket/shared';
import { eventsApi, venuesApi } from '../api/endpoints';
import { queryKeys } from '../lib/queryKeys';
import { apiErrorMessage } from '../lib/api';
import { Alert, Button, Card, Field, Input, Label, Loading, PageTitle, Select } from '../components/ui';

export default function CreateShow() {
  const { id: eventId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const venuesQuery = useQuery({ queryKey: queryKeys.venues, queryFn: () => venuesApi.list() });

  const [venueId, setVenueId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  // Only venues that already have a seat layout can host a show.
  const venues = useMemo(
    () => (venuesQuery.data ?? []).filter((v) => v._count.seats > 0),
    [venuesQuery.data],
  );
  const venue = venues.find((v) => v.id === venueId);

  const mutation = useMutation({
    mutationFn: () => {
      const input: CreateShowInput = {
        venueId,
        startsAt: new Date(startsAt).toISOString(),
        pricing: (venue?.categories ?? []).map((c) => ({
          seatCategoryId: c.id,
          price: Number(prices[c.id] ?? 0),
        })),
      };
      return eventsApi.createShow(eventId!, input);
    },
    onSuccess: () => navigate(`/organiser/events/${eventId}/summary`),
    onError: (err) => setError(apiErrorMessage(err, 'Could not create the show.')),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!venue) {
      setError('Pick a venue with a seat layout.');
      return;
    }
    mutation.mutate();
  };

  if (venuesQuery.isLoading) return <Loading />;

  return (
    <div className="mx-auto max-w-xl">
      <PageTitle title="Schedule a show" subtitle="Pick a venue, date, and set per-category pricing." />
      <Card className="p-6">
        {venues.length === 0 ? (
          <Alert tone="warning">
            No venues with a seat layout exist yet. An admin needs to create a venue and generate its
            seats first.
          </Alert>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {error && <Alert tone="error">{error}</Alert>}
            <Field label="Venue" htmlFor="venue">
              <Select
                id="venue"
                value={venueId}
                onChange={(e) => {
                  setVenueId(e.target.value);
                  setPrices({});
                }}
                required
              >
                <option value="">Select a venue…</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · {v._count.seats} seats
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Date & time" htmlFor="startsAt">
              <Input
                id="startsAt"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                required
              />
            </Field>

            {venue && (
              <div>
                <Label>Pricing per category</Label>
                <div className="space-y-2">
                  {venue.categories.map((c) => (
                    <div key={c.id} className="flex items-center gap-3">
                      <span className="flex flex-1 items-center gap-2 text-sm text-cream-muted">
                        <span
                          className="h-3.5 w-3.5 rounded-sm border border-white/10"
                          style={{ backgroundColor: c.color }}
                        />
                        {c.name}
                      </span>
                      <div className="relative w-40">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-cream-dim">
                          ₹
                        </span>
                        <Input
                          type="number"
                          min={0}
                          step="1"
                          required
                          className="pl-7"
                          value={prices[c.id] ?? ''}
                          onChange={(e) => setPrices((p) => ({ ...p, [c.id]: e.target.value }))}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Button type="submit" className="w-full" loading={mutation.isPending}>
              Create show
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
