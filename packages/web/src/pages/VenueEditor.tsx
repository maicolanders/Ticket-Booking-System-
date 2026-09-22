import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GenerateSeatsInput } from '@ticket/shared';
import { venuesApi } from '../api/endpoints';
import { queryKeys } from '../lib/queryKeys';
import { apiErrorMessage } from '../lib/api';
import type { VenueSeatModel } from '../api/types';
import { SeatLayoutEditor } from '../components/SeatLayoutEditor';
import { Alert, Badge, Button, Card, Input, Label, Loading, PageTitle } from '../components/ui';
import { ChevronLeftIcon } from '../components/icons';

function LayoutPreview({ seats }: { seats: VenueSeatModel[] }) {
  const rows = useMemo(() => {
    const byRow = new Map<number, VenueSeatModel[]>();
    for (const seat of seats) {
      const row = byRow.get(seat.gridRow) ?? [];
      row.push(seat);
      byRow.set(seat.gridRow, row);
    }
    return [...byRow.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, row]) => row.sort((a, b) => a.gridCol - b.gridCol));
  }, [seats]);

  if (seats.length === 0) {
    return <p className="text-sm text-cream-muted">No seats generated yet.</p>;
  }

  return (
    <div className="thin-scroll overflow-x-auto">
      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={row[0].gridRow} className="flex items-center gap-1.5">
            <span className="w-5 text-right font-mono text-xs text-cream-dim">{row[0].rowLabel}</span>
            <div className="flex gap-1">
              {row.map((seat) => (
                <span
                  key={seat.id}
                  title={`${seat.rowLabel}${seat.colNumber} · ${seat.category.name}`}
                  className="h-5 w-5 rounded-sm border border-white/10"
                  style={{ backgroundColor: seat.category.color }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function VenueEditor() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const [catName, setCatName] = useState('');
  const [catColor, setCatColor] = useState('#E0A44A');
  const [genError, setGenError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: queryKeys.venue(id!),
    queryFn: () => venuesApi.get(id!),
    enabled: Boolean(id),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.venue(id!) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.venues });
  };

  const categoryMutation = useMutation({
    mutationFn: () => venuesApi.createCategory(id!, { name: catName, color: catColor }),
    onSuccess: () => {
      setCatName('');
      invalidate();
    },
  });

  const seatsMutation = useMutation({
    mutationFn: (input: GenerateSeatsInput) => venuesApi.generateSeats(id!, input),
    onSuccess: () => {
      setGenError(null);
      invalidate();
    },
    onError: (err) => setGenError(apiErrorMessage(err, 'Could not generate seats.')),
  });

  if (query.isLoading) return <Loading />;
  if (query.isError || !query.data) return <Alert tone="error">Venue not found.</Alert>;
  const venue = query.data;

  const addCategory = (e: FormEvent) => {
    e.preventDefault();
    categoryMutation.mutate();
  };

  return (
    <div>
      <PageTitle
        title={venue.name}
        subtitle={venue.address}
        right={
          <Link
            to="/admin/venues"
            className="inline-flex items-center gap-1 text-sm text-cream-muted transition-colors hover:text-brass"
          >
            <ChevronLeftIcon size={16} /> All venues
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-3 font-display text-lg font-semibold text-cream">Seat categories</h2>
            <div className="mb-4 flex flex-wrap gap-1.5">
              {venue.categories.length === 0 ? (
                <p className="text-sm text-cream-muted">None yet.</p>
              ) : (
                venue.categories.map((c) => (
                  <Badge key={c.id} color={c.color}>
                    {c.name}
                  </Badge>
                ))
              )}
            </div>
            <form onSubmit={addCategory} className="flex items-end gap-2">
              <div className="flex-1">
                <Label htmlFor="catName">New category</Label>
                <Input
                  id="catName"
                  value={catName}
                  placeholder="e.g. Premium"
                  onChange={(e) => setCatName(e.target.value)}
                  required
                />
              </div>
              <input
                type="color"
                aria-label="Category colour"
                value={catColor}
                onChange={(e) => setCatColor(e.target.value)}
                className="h-10 w-12 cursor-pointer rounded-lg border border-ink-600 bg-ink-800"
              />
              <Button type="submit" loading={categoryMutation.isPending}>
                Add
              </Button>
            </form>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 font-display text-lg font-semibold text-cream">Generate seat layout</h2>
            {genError && (
              <div className="mb-3">
                <Alert tone="error">{genError}</Alert>
              </div>
            )}
            <SeatLayoutEditor
              categories={venue.categories}
              pending={seatsMutation.isPending}
              onGenerate={(input) => seatsMutation.mutate(input)}
            />
          </Card>
        </div>

        <Card className="p-5">
          <h2 className="mb-3 font-display text-lg font-semibold text-cream">
            Current layout{' '}
            <span className="text-sm font-normal text-cream-dim">({venue.seats.length} seats)</span>
          </h2>
          <LayoutPreview seats={venue.seats} />
        </Card>
      </div>
    </div>
  );
}
