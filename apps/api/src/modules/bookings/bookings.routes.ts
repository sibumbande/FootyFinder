import { Router, type Router as ExpressRouter } from 'express';
import { costlyMutationRateLimit } from '../../middleware/rate-limit.js';
import { registerUuidRouteParams } from '../../middleware/route-params.js';
import * as controller from './bookings.controller.js';

export const bookingsRouter: ExpressRouter = Router();
registerUuidRouteParams(bookingsRouter, ['bookingId']);
bookingsRouter.get('/fields', controller.fields);
bookingsRouter.get('/', controller.list);
bookingsRouter.post('/', costlyMutationRateLimit, controller.create);
bookingsRouter.get('/:bookingId', controller.get);
bookingsRouter.post('/:bookingId/contributions', costlyMutationRateLimit, controller.contribute);
