import { Router, type Router as ExpressRouter } from 'express';
import { costlyMutationRateLimit } from '../../middleware/rate-limit.js';
import { registerUuidRouteParams } from '../../middleware/route-params.js';
import * as controller from './admin.controller.js';

export const adminAuthRouter: ExpressRouter = Router();
adminAuthRouter.get('/status', controller.status);
adminAuthRouter.post('/mfa/setup', costlyMutationRateLimit, controller.setupMfa);
adminAuthRouter.post('/mfa/verify', costlyMutationRateLimit, controller.verifyMfa);

export const adminRouter: ExpressRouter = Router();
registerUuidRouteParams(adminRouter, ['venueId', 'fieldId', 'exceptionId']);
adminRouter.get('/audit-logs', controller.auditLog);
adminRouter.get('/venues', controller.listVenues);
adminRouter.post('/venues', costlyMutationRateLimit, controller.createVenue);
adminRouter.put('/venues/:venueId', costlyMutationRateLimit, controller.updateVenue);
adminRouter.post('/venues/:venueId/fields', costlyMutationRateLimit, controller.createField);
adminRouter.put('/fields/:fieldId', costlyMutationRateLimit, controller.updateField);
adminRouter.put('/fields/:fieldId/availability', costlyMutationRateLimit, controller.replaceFieldAvailability);
adminRouter.post('/fields/:fieldId/exceptions', costlyMutationRateLimit, controller.addFieldException);
adminRouter.delete('/fields/:fieldId/exceptions/:exceptionId', costlyMutationRateLimit, controller.removeFieldException);
adminRouter.post('/fields/:fieldId/prices', costlyMutationRateLimit, controller.addFieldPrice);
