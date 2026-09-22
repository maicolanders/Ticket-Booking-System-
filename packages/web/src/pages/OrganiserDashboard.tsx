import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { EventType } from '@ticket/shared';
import { eventsApi } from '../api/endpoints';
import { queryKeys } from '../lib/queryKeys';
import { Alert, Badge, Button, Card, EmptyState, Loading, PageTitle } from '../components/ui';
import { FilmIcon, MusicIcon, PlusIcon } from '../components/icons';

export default function OrganiserDashboard() {
  const query = useQuery({ queryKey: queryKeys.myEvents, queryFn: () => eventsApi.mine() });

  return (
    <div>
      <PageTitle
        title="Organiser dashboard"
        subtitle="Create events, schedule shows, and track revenue."
        right={
          <Link to="/organiser/events/new">
            <Button>
              <PlusIcon size={17} /> New event
            </Button>
          </Link>
        }
      />

      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <Alert tone="error">Couldn’t load your events.</Alert>
      ) : (query.data ?? []).length === 0 ? (
        <EmptyState
          title="No events yet"
          icon={<FilmIcon size={22} />}
          action={
            <Link to="/organiser/events/new">
              <Button>Create your first event</Button>
            </Link>
          }
        >
          Create an event, then schedule shows and watch bookings roll in.
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {query.data!.map((e) => (
            <Card key={e.id} className="flex flex-col p-5">
              <div className="mb-2 flex items-center gap-2">
                <Badge tone="brass">
                  {e.type === EventType.CONCERT ? <MusicIcon size={13} /> : <FilmIcon size={13} />}
                  {e.type === EventType.CONCERT ? 'Concert' : 'Movie'}
                </Badge>
                {e.genre && <Badge tone="neutral">{e.genre}</Badge>}
              </div>
              <h3 className="font-display text-lg font-semibold text-cream">{e.title}</h3>
              <p className="mt-1 text-sm text-cream-muted">
                {e.showCount} show{e.showCount === 1 ? '' : 's'}
              </p>
              <div className="mt-4 flex gap-2">
                <Link to={`/organiser/events/${e.id}/summary`} className="flex-1">
                  <Button variant="secondary" size="sm" className="w-full">
                    Summary
                  </Button>
                </Link>
                <Link to={`/organiser/events/${e.id}/shows/new`} className="flex-1">
                  <Button size="sm" className="w-full">
                    Add show
                  </Button>
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
