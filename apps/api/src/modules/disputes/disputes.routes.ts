import { Router, type Router as ExpressRouter } from 'express';
import { costlyMutationRateLimit } from '../../middleware/rate-limit.js';
import { registerUuidRouteParams } from '../../middleware/route-params.js';
import * as controller from './disputes.controller.js';

export const disputesRouter: ExpressRouter = Router();
registerUuidRouteParams(disputesRouter, ['resultId']);
disputesRouter.get('/', controller.listMine);
disputesRouter.post('/', costlyMutationRateLimit, controller.create);
disputesRouter.get('/results/:resultId/revisions', controller.revisions);
