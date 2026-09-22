import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { venuesApi } from '../api/endpoints';
import { queryKeys } from '../lib/queryKeys';
import { apiErrorMessage } from '../lib/api';
import { Alert, Button, Card, Field, Input, PageTitle } from '../components/ui';

export default function CreateVenue() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => venuesApi.create({ name, address }),
    onSuccess: (venue) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.venues });
      navigate(`/admin/venues/${venue.id}`);
    },
    onError: (err) => setError(apiErrorMessage(err, 'Could not create the venue.')),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  };

  return (
    <div className="mx-auto max-w-xl">
      <PageTitle title="New venue" subtitle="You’ll add categories and seats next." />
      <Card className="p-6">
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Name" htmlFor="name">
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Address" htmlFor="address">
            <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} required />
          </Field>
          <Button type="submit" className="w-full" loading={mutation.isPending}>
            Create venue
          </Button>
        </form>
      </Card>
    </div>
  );
}
