import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { venuesApi } from '../api/endpoints';
import { queryKeys } from '../lib/queryKeys';
import { Alert, Badge, Button, Card, EmptyState, Loading, PageTitle } from '../components/ui';
import { MapPinIcon, PlusIcon } from '../components/icons';

export default function AdminVenues() {
  const query = useQuery({ queryKey: queryKeys.venues, queryFn: () => venuesApi.list() });

  return (
    <div>
      <PageTitle
        title="Venues"
        subtitle="Manage venues, seat categories, and layouts."
        right={
          <Link to="/admin/venues/new">
            <Button>
              <PlusIcon size={17} /> New venue
            </Button>
          </Link>
        }
      />

      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <Alert tone="error">Couldn’t load venues.</Alert>
      ) : (query.data ?? []).length === 0 ? (
        <EmptyState
          title="No venues yet"
          icon={<MapPinIcon size={22} />}
          action={
            <Link to="/admin/venues/new">
              <Button>Create a venue</Button>
            </Link>
          }
        >
          A venue defines the seating map that shows are scheduled against.
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {query.data!.map((v) => (
            <Link key={v.id} to={`/admin/venues/${v.id}`} className="block">
              <Card interactive className="p-5">
                <h3 className="font-display text-lg font-semibold text-cream">{v.name}</h3>
                <p className="flex items-center gap-1.5 text-sm text-cream-muted">
                  <MapPinIcon size={14} className="text-cream-dim" />
                  {v.address}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {v.categories.map((c) => (
                    <Badge key={c.id} color={c.color}>
                      {c.name}
                    </Badge>
                  ))}
                </div>
                <p className="mt-3 text-xs text-cream-dim">
                  {v._count.seats} seats · {v._count.shows} show{v._count.shows === 1 ? '' : 's'}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
