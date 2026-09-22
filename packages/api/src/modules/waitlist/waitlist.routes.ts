import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../lib/asyncHandler';
import * as waitlistService from './waitlist.service';

export const waitlistRouter = Router();

// Fetch a time-limited offer's details for the completion page (owner-only).
waitlistRouter.get(
  '/offers/:token',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await waitlistService.getOffer(req.user!.id, req.params.token));
  }),
);

// Accept an offer → confirm the booking for the offered seat.
waitlistRouter.post(
  '/offers/:token/accept',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(201).json(await waitlistService.acceptOffer(req.user!.id, req.params.token));
  }),
);

// Leave the waitlist (WAITING entries only).
waitlistRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    await waitlistService.leaveWaitlist(req.user!.id, req.params.id);
    res.status(204).end();
  }),
);
