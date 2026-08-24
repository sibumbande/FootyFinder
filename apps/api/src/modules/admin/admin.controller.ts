import {
  adminMfaCodeSchema,
  managedFieldAvailabilityInputSchema,
  managedFieldExceptionInputSchema,
  managedFieldInputSchema,
  managedFieldPriceInputSchema,
  managedVenueInputSchema,
} from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { AppError } from '../../errors/app-error.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminService } from './admin.service.js';
import { AdminCatalogService } from './admin-catalog.service.js';

const auth = new AdminAuthService();
const admin = new AdminService();
const catalog = new AdminCatalogService();
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
