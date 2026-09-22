import { Link } from 'react-router-dom';
import { Button } from '../components/ui';
import { TicketIcon } from '../components/icons';

export default function NotFound() {
  return (
    <div className="grid place-items-center py-24 text-center">
      <div>
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-ink-800 text-brass">
          <TicketIcon size={26} />
        </div>
        <p className="font-display text-6xl font-semibold text-ink-500">404</p>
        <h1 className="mt-2 font-display text-xl font-semibold text-cream">Page not found</h1>
        <p className="mt-1 text-sm text-cream-muted">
          The page you’re looking for doesn’t exist or has moved.
        </p>
        <Link to="/" className="mt-6 inline-block">
          <Button>Back to browse</Button>
        </Link>
      </div>
    </div>
  );
}
