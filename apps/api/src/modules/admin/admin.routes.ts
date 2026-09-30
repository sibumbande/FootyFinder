import { Router, type Router as ExpressRouter } from 'express';
import { costlyMutationRateLimit } from '../../middleware/rate-limit.js';
import { registerUuidRouteParams } from '../../middleware/route-params.js';
import * as controller from './admin.controller.js';
import * as moderation from '../moderation/moderation.controller.js';
import * as disputes from '../disputes/disputes.controller.js';
import * as finance from '../payments/admin-finance.controller.js';
import * as settlement from '../settlement/venue-settlement.controller.js';
import * as settlementBatches from '../settlement/settlement-batches.controller.js';
import * as referees from '../referees/referees.admin.controller.js';
import { requireRecentAdminMfa } from '../../middleware/require-admin.js';

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
  'paymentId',
  'refundId',
  'beneficiaryId',
  'payableId',
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
// Gate 6 / TKT-606: card top-ups, refunds to card, chargebacks and wallet restrictions.
adminRouter.get('/finance/top-ups', finance.listTopUps);
adminRouter.get('/finance/top-ups/:paymentId', finance.getTopUp);
adminRouter.post('/finance/top-ups/:paymentId/refunds', costlyMutationRateLimit, finance.refundTopUp);
adminRouter.post('/finance/refunds/:refundId/retry', costlyMutationRateLimit, finance.retryRefund);
adminRouter.post('/finance/refunds/:refundId/restore', costlyMutationRateLimit, finance.restoreRefund);
adminRouter.get('/finance/restricted-wallets', finance.restrictedWallets);
adminRouter.post('/finance/wallets/:userId/lift-restriction', costlyMutationRateLimit, finance.liftRestriction);
// Gate 6 / TKT-607: venue beneficiaries (encrypted bank details) and payables. Admin-only.
adminRouter.get('/venues/:venueId/beneficiaries', settlement.listBeneficiaries);
adminRouter.post('/venues/:venueId/beneficiaries', costlyMutationRateLimit, settlement.createBeneficiary);
adminRouter.post('/beneficiaries/:beneficiaryId/approve', costlyMutationRateLimit, settlement.approveBeneficiary);
adminRouter.post('/beneficiaries/:beneficiaryId/reveal', costlyMutationRateLimit, settlement.revealBeneficiary);
adminRouter.get('/settlement/payables', settlement.listPayables);
adminRouter.post('/settlement/payables/:payableId/adjustments', costlyMutationRateLimit, settlement.adjustPayable);
// Gate 6 / TKT-608: weekly dual-control settlement queue. Approve and mark-paid need fresh MFA.
adminRouter.get('/settlement/due', settlementBatches.due);
adminRouter.get('/settlement/batches', settlementBatches.list);
adminRouter.get('/settlement/batches/:batchId', settlementBatches.get);
adminRouter.post('/settlement/batches', costlyMutationRateLimit, settlementBatches.prepare);
adminRouter.post('/settlement/batches/:batchId/approve', costlyMutationRateLimit, requireRecentAdminMfa, settlementBatches.approve);
adminRouter.post('/settlement/batches/:batchId/mark-paid', costlyMutationRateLimit, requireRecentAdminMfa, settlementBatches.markPaid);
adminRouter.post('/settlement/batches/:batchId/cancel', costlyMutationRateLimit, settlementBatches.cancel);
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
// Gate 8 / TKT-801 (DEC-020): the referee role. Granting and removing need fresh MFA (D25).
adminRouter.get('/referees', referees.listReferees);
adminRouter.post('/referees/:userId', costlyMutationRateLimit, requireRecentAdminMfa, referees.grantReferee);
adminRouter.post('/referees/:userId/revoke', costlyMutationRateLimit, requireRecentAdminMfa, referees.revokeReferee);
