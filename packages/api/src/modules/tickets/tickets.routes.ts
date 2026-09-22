import { Router } from 'express';
import { Role } from '@ticket/shared';
import { requireAuth, requireRole } from '../../middleware/auth';
import { badRequest } from '../../lib/errors';
import { asyncHandler } from '../../lib/asyncHandler';
import * as ticketService from './tickets.service';

export const ticketsRouter = Router();

// Gate verification of a scanned QR token (staff only). One-segment path, so it
// does not collide with '/:reference/qr'.
ticketsRouter.get(
  '/verify',
  requireAuth,
  requireRole(Role.ORGANISER, Role.ADMIN),
  asyncHandler(async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!token) throw badRequest('token query parameter is required');
    res.json(await ticketService.verifyTicket(token));
  }),
);

// QR image (data URL) for a booking the requester owns.
ticketsRouter.get(
  '/:reference/qr',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await ticketService.getTicketQr(req.params.reference, req.user!.id));
  }),
);
