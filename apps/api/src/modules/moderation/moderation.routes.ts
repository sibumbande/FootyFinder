import { Router, type Router as ExpressRouter } from 'express';
import { costlyMutationRateLimit } from '../../middleware/rate-limit.js';
import * as controller from './moderation.controller.js';

export const moderationRouter: ExpressRouter = Router();
moderationRouter.get('/reports', controller.listMyReports);
moderationRouter.post('/reports', costlyMutationRateLimit, controller.createReport);
