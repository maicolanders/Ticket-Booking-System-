import { Router } from 'express';
import { createBookingSchema } from '@ticket/shared';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import * as bookingService from './bookings.service';

export const bookingsRouter = Router();

// Confirm a booking from an active hold → generates the QR ticket + emails it.
bookingsRouter.post(
  '/',
  requireAuth,
  validateBody(createBookingSchema),
  asyncHandler(async (req, res) => {
    res
      .status(201)
      .json(await bookingService.createBooking(req.user!.id, req.body.holdId, req.body.paymentToken));
  }),
);

// Booking history for the signed-in customer.
bookingsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await bookingService.listBookings(req.user!.id));
  }),
);

// Booking detail by reference (includes the QR data URL).
bookingsRouter.get(
  '/:reference',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await bookingService.getBookingByReference(req.params.reference, req.user!.id));
  }),
);

// Cancel a booking (frees seats → triggers the waitlist offer flow).
bookingsRouter.post(
  '/:id/cancel',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await bookingService.cancelBooking(req.user!.id, req.params.id));
  }),
);
