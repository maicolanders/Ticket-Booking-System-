import { Router } from 'express';
import {
  createEventSchema,
  createShowSchema,
  eventFilterSchema,
  Role,
  type EventFilterInput,
} from '@ticket/shared';
import { requireAuth, requireRole, optionalAuth } from '../../middleware/auth';
import { validateBody, validateQuery } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import * as eventService from './events.service';
import * as showService from '../shows/shows.service';
import * as reportService from '../reports/reports.service';

export const eventsRouter = Router();

// Public browse + filter (type/date/search/venue).
eventsRouter.get(
  '/',
  optionalAuth,
  validateQuery(eventFilterSchema),
  asyncHandler(async (req, res) => {
    res.json(await eventService.listEvents(req.query as unknown as EventFilterInput));
  }),
);

// The signed-in organiser's own events — registered before '/:id' so it isn't
// swallowed by the parameterized route.
eventsRouter.get(
  '/mine',
  requireAuth,
  requireRole(Role.ORGANISER),
  asyncHandler(async (req, res) => {
    res.json(await eventService.listOrganiserEvents(req.user!.id));
  }),
);

eventsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await eventService.getEvent(req.params.id));
  }),
);

// Organiser booking + revenue summary for one of their events.
eventsRouter.get(
  '/:id/summary',
  requireAuth,
  requireRole(Role.ORGANISER),
  asyncHandler(async (req, res) => {
    res.json(await reportService.getEventSummary(req.user!.id, req.params.id));
  }),
);

eventsRouter.post(
  '/',
  requireAuth,
  requireRole(Role.ORGANISER),
  validateBody(createEventSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await eventService.createEvent(req.user!.id, req.body));
  }),
);

// Create a show for an event (snapshots the venue's seats + per-category pricing).
eventsRouter.post(
  '/:id/shows',
  requireAuth,
  requireRole(Role.ORGANISER),
  validateBody(createShowSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await showService.createShow(req.user!.id, req.params.id, req.body));
  }),
);
