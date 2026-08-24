import {
  adminModerationReportQuerySchema,
  adminModerationUserQuerySchema,
  createAccountEnforcementSchema,
  createModerationReportSchema,
  revokeAccountEnforcementSchema,
  updateModerationReportSchema,
} from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { ModerationService } from './moderation.service.js';

const service = new ModerationService();
const userId = (locals: Record<string, unknown>) => String(locals.authUserId);
const requestId = (locals: Record<string, unknown>) => String(locals.requestId);

export const createReport: RequestHandler = async (req, res, next) => {
  try { res.status(201).json({ data: await service.createReport(userId(res.locals), createModerationReportSchema.parse(req.body)) }); } catch (error) { next(error); }
};
export const listMyReports: RequestHandler = async (_req, res, next) => {
  try { res.json({ data: await service.listMine(userId(res.locals)) }); } catch (error) { next(error); }
};
export const listReports: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await service.listReports(adminModerationReportQuerySchema.parse(req.query), userId(res.locals)) }); } catch (error) { next(error); }
};
export const getReport: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await service.getReport(String(req.params.reportId)) }); } catch (error) { next(error); }
};
export const updateReport: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await service.updateReport(String(req.params.reportId), userId(res.locals), updateModerationReportSchema.parse(req.body), requestId(res.locals)) }); } catch (error) { next(error); }
};
export const listUsers: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await service.listUsers(adminModerationUserQuerySchema.parse(req.query)) }); } catch (error) { next(error); }
};
export const getUser: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await service.getUser(String(req.params.userId)) }); } catch (error) { next(error); }
};
export const enforceUser: RequestHandler = async (req, res, next) => {
  try { res.status(201).json({ data: await service.enforce(String(req.params.userId), userId(res.locals), createAccountEnforcementSchema.parse(req.body), requestId(res.locals)) }); } catch (error) { next(error); }
};
export const revokeEnforcement: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await service.revokeEnforcement(String(req.params.userId), String(req.params.enforcementId), userId(res.locals), revokeAccountEnforcementSchema.parse(req.body), requestId(res.locals)) }); } catch (error) { next(error); }
};
