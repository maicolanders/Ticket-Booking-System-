import { Router } from 'express';
import { createVenueSchema, createCategorySchema, generateSeatsSchema, Role } from '@ticket/shared';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import * as venueService from './venues.service';

export const venuesRouter = Router();

// Any authenticated user can read venues (organisers pick one when creating a show).
venuesRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => res.json(await venueService.listVenues())),
);

venuesRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => res.json(await venueService.getVenue(req.params.id))),
);

// Admin-only management.
venuesRouter.post(
  '/',
  requireAuth,
  requireRole(Role.ADMIN),
  validateBody(createVenueSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await venueService.createVenue(req.body));
  }),
);

venuesRouter.post(
  '/:id/categories',
  requireAuth,
  requireRole(Role.ADMIN),
  validateBody(createCategorySchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await venueService.createCategory(req.params.id, req.body));
  }),
);

venuesRouter.post(
  '/:id/seats',
  requireAuth,
  requireRole(Role.ADMIN),
  validateBody(generateSeatsSchema),
  asyncHandler(async (req, res) => {
    res.json(await venueService.generateSeats(req.params.id, req.body));
  }),
);
