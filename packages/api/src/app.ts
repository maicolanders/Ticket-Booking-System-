import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { corsOrigins } from './config/env';
import { notFoundHandler, errorHandler } from './middleware/error';
import { authRouter } from './modules/auth/auth.routes';
import { venuesRouter } from './modules/venues/venues.routes';
import { eventsRouter } from './modules/events/events.routes';
import { showsRouter } from './modules/shows/shows.routes';
import { holdsRouter } from './modules/holds/holds.routes';
import { bookingsRouter } from './modules/bookings/bookings.routes';
import { waitlistRouter } from './modules/waitlist/waitlist.routes';
import { ticketsRouter } from './modules/tickets/tickets.routes';

/** Build the Express app (kept separate from server bootstrap so tests can import it). */
export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: corsOrigins, credentials: true }));
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/venues', venuesRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/shows', showsRouter);
  app.use('/api/holds', holdsRouter);
  app.use('/api/bookings', bookingsRouter);
  app.use('/api/waitlist', waitlistRouter);
  app.use('/api/tickets', ticketsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
