import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { EventType } from '@ticket/shared';
import { eventsApi } from '../api/endpoints';
import { apiErrorMessage } from '../lib/api';
import { Alert, Button, Card, Field, Input, PageTitle, SegmentedControl, Textarea } from '../components/ui';

export default function CreateEvent() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<EventType>(EventType.MOVIE);
  const [genre, setGenre] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      eventsApi.create({ title, description, type, genre, imageUrl: imageUrl || '' }),
    onSuccess: (created) => navigate(`/organiser/events/${created.id}/shows/new`),
    onError: (err) => setError(apiErrorMessage(err, 'Could not create the event.')),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  };

  return (
    <div className="mx-auto max-w-xl">
      <PageTitle title="New event" subtitle="You’ll add showtimes next." />
      <Card className="p-6">
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Type" htmlFor="type">
            <SegmentedControl<EventType>
              value={type}
              onChange={setType}
              options={[
                { value: EventType.MOVIE, label: 'Movie' },
                { value: EventType.CONCERT, label: 'Concert' },
              ]}
            />
          </Field>
          <Field label="Title" htmlFor="title">
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </Field>
          <Field label="Genre" htmlFor="genre">
            <Input
              id="genre"
              value={genre}
              placeholder="e.g. Sci-Fi, Synthwave"
              onChange={(e) => setGenre(e.target.value)}
            />
          </Field>
          <Field label="Poster image URL" htmlFor="image" hint="Optional — shown on the event card.">
            <Input
              id="image"
              type="url"
              value={imageUrl}
              placeholder="https://…"
              onChange={(e) => setImageUrl(e.target.value)}
            />
          </Field>
          <Field label="Description" htmlFor="desc">
            <Textarea id="desc" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Button type="submit" className="w-full" loading={mutation.isPending}>
            Create event &amp; add show
          </Button>
        </form>
      </Card>
    </div>
  );
}
