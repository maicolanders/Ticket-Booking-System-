import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../lib/asyncHandler';
import * as holdService from './holds.service';

export const holdsRouter = Router();

// Release a hold early (checkout abandoned). Idempotent.
holdsRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    await holdService.releaseHold(req.user!.id, req.params.id);
    res.status(204).end();
  }),
);
