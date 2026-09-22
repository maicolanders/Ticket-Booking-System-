import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { eventsApi } from '../api/endpoints';
import { queryKeys } from '../lib/queryKeys';
import { formatDateTime, formatMoney } from '../lib/format';
import { Alert, Card, Loading, PageTitle } from '../components/ui';
import { PlusIcon } from '../components/icons';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wide text-cream-dim">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold text-cream">{value}</p>
    </Card>
  );
}

function OccupancyBar({ booked, capacity }: { booked: number; capacity: number }) {
  const pct = capacity ? Math.round((booked / capacity) * 100) : 0;
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
      <div className="h-full rounded-full bg-brass" style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function EventSummary() {
  const { id } = useParams<{ id: string }>();
  const query = useQuery({
    queryKey: queryKeys.eventSummary(id!),
    queryFn: () => eventsApi.summary(id!),
    enabled: Boolean(id),
  });

  if (query.isLoading) return <Loading />;
  if (query.isError || !query.data) return <Alert tone="error">Couldn’t load the summary.</Alert>;
  const s = query.data;
  const occupancy = s.totalCapacity ? Math.round((s.totalBooked / s.totalCapacity) * 100) : 0;

  return (
    <div>
      <PageTitle
        title={s.title}
        subtitle="Bookings & revenue"
        right={
          <Link
            to={`/organiser/events/${id}/shows/new`}
            className="inline-flex items-center gap-1 text-sm font-medium text-brass transition-colors hover:text-brass-bright"
          >
            <PlusIcon size={16} /> Add show
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Total revenue" value={formatMoney(s.totalRevenue)} />
        <Stat label="Seats booked" value={`${s.totalBooked} / ${s.totalCapacity}`} />
        <Stat label="Occupancy" value={`${occupancy}%`} />
      </div>

      {s.shows.length === 0 ? (
        <Alert tone="info">No shows scheduled yet.</Alert>
      ) : (
        <div className="space-y-4">
          {s.shows.map((show) => (
            <Card key={show.showId} className="overflow-hidden">
              <div className="border-b border-ink-600 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-semibold text-cream">{formatDateTime(show.startsAt)}</p>
                    <p className="text-sm text-cream-muted">{show.venueName}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-cream">{formatMoney(show.revenue)}</p>
                    <p className="text-sm text-cream-muted">
                      {show.booked} / {show.capacity} booked
                    </p>
                  </div>
                </div>
                <OccupancyBar booked={show.booked} capacity={show.capacity} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-cream-dim">
                      <th className="px-4 py-2 font-medium">Category</th>
                      <th className="px-4 py-2 text-right font-medium">Price</th>
                      <th className="px-4 py-2 text-right font-medium">Booked</th>
                      <th className="px-4 py-2 text-right font-medium">Available</th>
                      <th className="px-4 py-2 text-right font-medium">Revenue</th>
                      <th className="px-4 py-2 text-right font-medium">Waiting</th>
                    </tr>
                  </thead>
                  <tbody>
                    {show.categories.map((c) => (
                      <tr key={c.seatCategoryId} className="border-t border-ink-600">
                        <td className="px-4 py-2">
                          <span className="flex items-center gap-2 text-cream-muted">
                            <span
                              className="h-3 w-3 rounded-sm border border-white/10"
                              style={{ backgroundColor: c.color }}
                            />
                            {c.name}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right text-cream-muted">{formatMoney(c.price)}</td>
                        <td className="px-4 py-2 text-right text-cream">{c.booked}</td>
                        <td className="px-4 py-2 text-right text-cream-muted">{c.available}</td>
                        <td className="px-4 py-2 text-right font-medium text-cream">
                          {formatMoney(c.revenue)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {c.waiting > 0 ? (
                            <span className="font-medium text-warning">{c.waiting}</span>
                          ) : (
                            <span className="text-cream-dim">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
