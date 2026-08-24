import {
  adminMfaCodeSchema,
  managedFieldAvailabilityInputSchema,
  managedFieldExceptionInputSchema,
  managedFieldInputSchema,
  managedFieldPriceInputSchema,
  managedVenueInputSchema,
  adminSupportListQuerySchema,
  adminSupportReplySchema,
  updateSupportTicketSchema,
  createAdminTestDataBatchSchema,
  managedMatchBookingSchema,
} from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { AppError } from '../../errors/app-error.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminService } from './admin.service.js';
import { AdminCatalogService } from './admin-catalog.service.js';
import { SupportService } from '../support/support.service.js';
import { AdminTestDataService } from './admin-test-data.service.js';
import { WalletReconciliationService } from '../wallet/wallet-reconciliation.service.js';
import { BookingsService } from '../bookings/bookings.service.js';

const auth = new AdminAuthService();
const admin = new AdminService();
const catalog = new AdminCatalogService();
const support = new SupportService();
const testData = new AdminTestDataService();
const reconciliation = new WalletReconciliationService();
const bookings = new BookingsService();
const actor = (locals: Record<string, unknown>) => String(locals.authUserId);
const requestId = (locals: Record<string, unknown>) => String(locals.requestId);
const identity = (locals: Record<string, unknown>) => {
  if (typeof locals.authSessionId !== 'string')
    throw new AppError(401, 'A persisted session is required.', 'UNAUTHENTICATED');
  return { userId: String(locals.authUserId), sessionId: locals.authSessionId };
};

export const status: RequestHandler = async (_req, res, next) => {
  try {
    const { userId, sessionId } = identity(res.locals);
    res.json({ data: await auth.status(userId, sessionId) });
  } catch (error) {
    next(error);
  }
};
export const setupMfa: RequestHandler = async (_req, res, next) => {
  try {
    const { userId, sessionId } = identity(res.locals);
    res.json({ data: await auth.setup(userId, sessionId, String(res.locals.requestId)) });
  } catch (error) {
    next(error);
  }
};
export const verifyMfa: RequestHandler = async (req, res, next) => {
  try {
    const { userId, sessionId } = identity(res.locals);
    const { code } = adminMfaCodeSchema.parse(req.body);
    res.json({ data: await auth.verify(userId, sessionId, code, String(res.locals.requestId)) });
  } catch (error) {
    next(error);
  }
};
export const auditLog: RequestHandler = async (_req, res, next) => {
  try {
    res.json({ data: await admin.auditLog() });
  } catch (error) {
    next(error);
  }
};

export const listVenues: RequestHandler = async (_req, res, next) => {
  try { res.json({ data: await catalog.list() }); } catch (error) { next(error); }
};
export const createVenue: RequestHandler = async (req, res, next) => {
  try { res.status(201).json({ data: await catalog.createVenue(managedVenueInputSchema.parse(req.body), actor(res.locals), requestId(res.locals)) }); } catch (error) { next(error); }
};
export const updateVenue: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await catalog.updateVenue(String(req.params.venueId), managedVenueInputSchema.parse(req.body), actor(res.locals), requestId(res.locals)) }); } catch (error) { next(error); }
};
export const createField: RequestHandler = async (req, res, next) => {
  try { res.status(201).json({ data: await catalog.createField(String(req.params.venueId), managedFieldInputSchema.parse(req.body), actor(res.locals), requestId(res.locals)) }); } catch (error) { next(error); }
};
export const updateField: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await catalog.updateField(String(req.params.fieldId), managedFieldInputSchema.parse(req.body), actor(res.locals), requestId(res.locals)) }); } catch (error) { next(error); }
};
export const replaceFieldAvailability: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await catalog.replaceAvailability(String(req.params.fieldId), managedFieldAvailabilityInputSchema.parse(req.body), actor(res.locals), requestId(res.locals)) }); } catch (error) { next(error); }
};
export const addFieldException: RequestHandler = async (req, res, next) => {
  try { res.status(201).json({ data: await catalog.addException(String(req.params.fieldId), managedFieldExceptionInputSchema.parse(req.body), actor(res.locals), requestId(res.locals)) }); } catch (error) { next(error); }
};
export const removeFieldException: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await catalog.removeException(String(req.params.fieldId), String(req.params.exceptionId), actor(res.locals), requestId(res.locals)) }); } catch (error) { next(error); }
};
export const addFieldPrice: RequestHandler = async (req, res, next) => {
  try { res.status(201).json({ data: await catalog.addPrice(String(req.params.fieldId), managedFieldPriceInputSchema.parse(req.body), actor(res.locals), requestId(res.locals)) }); } catch (error) { next(error); }
};
export const listSupportTickets: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await support.listAdmin(adminSupportListQuerySchema.parse(req.query), actor(res.locals)) }); } catch (error) { next(error); }
};
export const getSupportTicket: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await support.getAdmin(String(req.params.ticketId)) }); } catch (error) { next(error); }
};
export const replySupportTicket: RequestHandler = async (req, res, next) => {
  try { res.status(201).json({ data: await support.replyAdmin(String(req.params.ticketId), actor(res.locals), adminSupportReplySchema.parse(req.body), requestId(res.locals)) }); } catch (error) { next(error); }
};
export const updateSupportTicket: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await support.updateAdmin(String(req.params.ticketId), actor(res.locals), updateSupportTicketSchema.parse(req.body), requestId(res.locals)) }); } catch (error) { next(error); }
};
export const testDataStatus: RequestHandler = (_req, res) => { res.json({ data: testData.status() }); };
export const listTestData: RequestHandler = async (_req, res, next) => {
  try { res.json({ data: await testData.list() }); } catch (error) { next(error); }
};
export const createTestData: RequestHandler = async (req, res, next) => {
  try { res.status(201).json({ data: await testData.create(createAdminTestDataBatchSchema.parse(req.body), actor(res.locals), requestId(res.locals)) }); } catch (error) { next(error); }
};
export const removeTestData: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await testData.remove(String(req.params.batchId), actor(res.locals), requestId(res.locals)) }); } catch (error) { next(error); }
};
export const walletReconciliation: RequestHandler = async (_req, res, next) => {
  try { res.json({ data: await reconciliation.report() }); } catch (error) { next(error); }
};
export const listManagedMatches: RequestHandler = async (_req, res, next) => {
  try { res.json({ data: await bookings.listAdmin() }); } catch (error) { next(error); }
};
export const createManagedMatch: RequestHandler = async (req, res, next) => {
  try { res.status(201).json({ data: await bookings.createAdmin(managedMatchBookingSchema.parse(req.body), actor(res.locals), requestId(res.locals)) }); } catch (error) { next(error); }
};
