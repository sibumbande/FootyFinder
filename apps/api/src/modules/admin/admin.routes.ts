import { Router, type Router as ExpressRouter } from 'express';
import { costlyMutationRateLimit } from '../../middleware/rate-limit.js';
import { registerUuidRouteParams } from '../../middleware/route-params.js';
import * as controller from './admin.controller.js';
import * as moderation from '../moderation/moderation.controller.js';
import * as disputes from '../disputes/disputes.controller.js';

export const adminAuthRouter: ExpressRouter = Router();
adminAuthRouter.get('/status', controller.status);
adminAuthRouter.post('/mfa/setup', costlyMutationRateLimit, controller.setupMfa);
adminAuthRouter.post('/mfa/verify', costlyMutationRateLimit, controller.verifyMfa);

export const adminRouter: ExpressRouter = Router();
registerUuidRouteParams(adminRouter, [
  'venueId',
  'fieldId',
  'exceptionId',
  'ticketId',
  'batchId',
  'reportId',
  'userId',
  'enforcementId',
  'disputeId',
]);
adminRouter.get('/operations/summary', controller.operationsSummary);
adminRouter.get('/audit-logs', controller.auditLog);
adminRouter.get('/venues', controller.listVenues);
adminRouter.post('/venues', costlyMutationRateLimit, controller.createVenue);
adminRouter.put('/venues/:venueId', costlyMutationRateLimit, controller.updateVenue);
adminRouter.put('/venues/:venueId/media', costlyMutationRateLimit, controller.replaceVenueMedia);
adminRouter.post('/venues/:venueId/cancellation-policies', costlyMutationRateLimit, controller.addVenueCancellationPolicy);
adminRouter.post('/venues/:venueId/submit', costlyMutationRateLimit, controller.submitVenue);
adminRouter.post('/venues/:venueId/approve', costlyMutationRateLimit, controller.approveVenue);
adminRouter.post('/venues/:venueId/deactivate', costlyMutationRateLimit, controller.deactivateVenue);
adminRouter.post('/venues/:venueId/fields', costlyMutationRateLimit, controller.createField);
adminRouter.put('/fields/:fieldId', costlyMutationRateLimit, controller.updateField);
adminRouter.put(
  '/fields/:fieldId/availability',
  costlyMutationRateLimit,
  controller.replaceFieldAvailability,
);
adminRouter.post(
  '/fields/:fieldId/exceptions',
  costlyMutationRateLimit,
  controller.addFieldException,
);
adminRouter.delete(
  '/fields/:fieldId/exceptions/:exceptionId',
  costlyMutationRateLimit,
  controller.removeFieldException,
);
adminRouter.post('/fields/:fieldId/prices', costlyMutationRateLimit, controller.addFieldPrice);
adminRouter.get('/support/tickets', controller.listSupportTickets);
adminRouter.get('/support/tickets/:ticketId', controller.getSupportTicket);
adminRouter.post(
  '/support/tickets/:ticketId/messages',
  costlyMutationRateLimit,
  controller.replySupportTicket,
);
adminRouter.put(
  '/support/tickets/:ticketId',
  costlyMutationRateLimit,
  controller.updateSupportTicket,
);
adminRouter.get('/test-data/status', controller.testDataStatus);
adminRouter.get('/test-data/batches', controller.listTestData);
adminRouter.post('/test-data/batches', costlyMutationRateLimit, controller.createTestData);
adminRouter.delete(
  '/test-data/batches/:batchId',
  costlyMutationRateLimit,
  controller.removeTestData,
);
adminRouter.get('/finance/reconciliation', controller.walletReconciliation);
adminRouter.get('/matches', controller.listManagedMatches);
adminRouter.post('/matches', costlyMutationRateLimit, controller.createManagedMatch);
adminRouter.get('/moderation/reports', moderation.listReports);
adminRouter.get('/moderation/reports/:reportId', moderation.getReport);
adminRouter.put('/moderation/reports/:reportId', costlyMutationRateLimit, moderation.updateReport);
adminRouter.get('/moderation/users', moderation.listUsers);
adminRouter.get('/moderation/users/:userId', moderation.getUser);
adminRouter.post(
  '/moderation/users/:userId/enforcements',
  costlyMutationRateLimit,
  moderation.enforceUser,
);
adminRouter.post(
  '/moderation/users/:userId/enforcements/:enforcementId/revoke',
  costlyMutationRateLimit,
  moderation.revokeEnforcement,
);
adminRouter.get('/disputes', disputes.listAdmin);
adminRouter.get('/disputes/:disputeId', disputes.getAdmin);
adminRouter.put('/disputes/:disputeId/review', costlyMutationRateLimit, disputes.review);
adminRouter.post('/disputes/:disputeId/resolve', costlyMutationRateLimit, disputes.resolve);
