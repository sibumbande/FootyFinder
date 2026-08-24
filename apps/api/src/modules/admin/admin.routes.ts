import { Router, type Router as ExpressRouter } from 'express';
import { costlyMutationRateLimit } from '../../middleware/rate-limit.js';
import * as controller from './admin.controller.js';

export const adminAuthRouter: ExpressRouter = Router();
adminAuthRouter.get('/status', controller.status);
adminAuthRouter.post('/mfa/setup', costlyMutationRateLimit, controller.setupMfa);
adminAuthRouter.post('/mfa/verify', costlyMutationRateLimit, controller.verifyMfa);

export const adminRouter: ExpressRouter = Router();
adminRouter.get('/audit-logs', controller.auditLog);
