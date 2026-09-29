import { Router, type RequestHandler, type Router as ExpressRouter } from 'express';
import { AppError } from '../../errors/app-error.js';
import { registerUuidRouteParams } from '../../middleware/route-params.js';
import * as controller from './bookings.controller.js';

export const bookingsRouter: ExpressRouter = Router();
registerUuidRouteParams(bookingsRouter, ['bookingId']);

// DEC-018: players no longer fund venue costs, so the pooled player field-booking flow is retired.
// Booking history stays readable (without any venue cost); the write and catalogue routes answer
// with a stable 410 so older clients get a clear error instead of a silent 404.
const retired: RequestHandler = (_req, _res, next) =>
  next(
    new AppError(
      410,
      'Player field bookings have been retired. Create a Quick Match from a venue slot instead.',
      'PLAYER_FIELD_BOOKING_RETIRED',
    ),
  );
bookingsRouter.get('/fields', retired);
bookingsRouter.post('/', retired);
bookingsRouter.post('/:bookingId/contributions', retired);
bookingsRouter.get('/', controller.list);
bookingsRouter.get('/:bookingId', controller.get);
