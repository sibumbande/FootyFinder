import { Router, type Router as ExpressRouter } from 'express';
import { costlyMutationRateLimit, messageRateLimit } from '../../middleware/rate-limit.js';
import { registerUuidRouteParams } from '../../middleware/route-params.js';
import * as controller from './support.controller.js';

export const supportRouter: ExpressRouter = Router();
registerUuidRouteParams(supportRouter, ['ticketId']);
supportRouter.get('/tickets', controller.list);
supportRouter.post('/tickets', costlyMutationRateLimit, controller.create);
supportRouter.get('/tickets/:ticketId', controller.get);
supportRouter.post('/tickets/:ticketId/messages', messageRateLimit, controller.reply);
