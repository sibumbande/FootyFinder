import { Router, type Router as ExpressRouter } from 'express';
import { costlyMutationRateLimit } from '../../middleware/rate-limit.js';
import { registerUuidRouteParams } from '../../middleware/route-params.js';
import * as controller from './referee.controller.js';

/** Gate 8 (DEC-020): what a FootyFinder referee does in the main app. */
export const refereeRouter: ExpressRouter = Router();
registerUuidRouteParams(refereeRouter, ['matchId']);
refereeRouter.post('/matches/:matchId/decline', costlyMutationRateLimit, controller.decline);
refereeRouter.post('/matches/:matchId/result', costlyMutationRateLimit, controller.submitResult);
