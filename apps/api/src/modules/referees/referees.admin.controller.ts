import {
  adminRefereeMatchQuerySchema,
  assignRefereeSchema,
  refereeRoleChangeSchema,
  refereeSettingsSchema,
  removeRefereeSchema,
  adminResultQuerySchema,
  adminResultEntrySchema,
  adminResultProblemQuerySchema,
  resolveResultProblemSchema,
  adminRefereeReportQuerySchema,
} from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { RefereeAssignmentService } from './referee-assignment.service.js';
import { RefereeRoleService } from './referee-role.service.js';
import { AdminResultsService } from './admin-results.service.js';

const roles = new RefereeRoleService();
const assignments = new RefereeAssignmentService();
const results = new AdminResultsService();
const adminId = (locals: Record<string, unknown>) => String(locals.authUserId);
const requestId = (locals: Record<string, unknown>) => String(locals.requestId);
const matchId = (params: Record<string, unknown>) => String(params.matchId);

export const listReferees: RequestHandler = async (_req, res, next) => {
  try { res.json({ data: await roles.list() }); } catch (error) { next(error); }
};
export const grantReferee: RequestHandler = async (req, res, next) => {
  try { res.status(201).json({ data: await roles.grant(String(req.params.userId), adminId(res.locals), refereeRoleChangeSchema.parse(req.body), requestId(res.locals)) }); } catch (error) { next(error); }
};
export const revokeReferee: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await roles.revoke(String(req.params.userId), adminId(res.locals), refereeRoleChangeSchema.parse(req.body), requestId(res.locals)) }); } catch (error) { next(error); }
};
// Gate 8 / TKT-802: assignment, availability (D27) and the default referee (D28).
export const listRefereeMatches: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await assignments.listMatches(adminRefereeMatchQuerySchema.parse(req.query)) }); } catch (error) { next(error); }
};
export const refereeOptions: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await assignments.options(matchId(req.params)) }); } catch (error) { next(error); }
};
export const assignReferee: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await assignments.assign(matchId(req.params), adminId(res.locals), assignRefereeSchema.parse(req.body), requestId(res.locals)) }); } catch (error) { next(error); }
};
export const removeReferee: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await assignments.remove(matchId(req.params), adminId(res.locals), removeRefereeSchema.parse(req.body), requestId(res.locals)) }); } catch (error) { next(error); }
};
export const refereeSettings: RequestHandler = async (_req, res, next) => {
  try { res.json({ data: await assignments.getSettings() }); } catch (error) { next(error); }
};
export const updateRefereeSettings: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await assignments.setSettings(adminId(res.locals), refereeSettingsSchema.parse(req.body), requestId(res.locals)) }); } catch (error) { next(error); }
};
// Gate 8 / TKT-807: results queue, admin entry/correction (D3, D5), problem reports (D6), report (D8).
export const resultQueue: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await results.queue(adminResultQuerySchema.parse(req.query)) }); } catch (error) { next(error); }
};
export const resultDetail: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await results.detail(matchId(req.params)) }); } catch (error) { next(error); }
};
export const enterResult: RequestHandler = async (req, res, next) => {
  try { res.status(201).json({ data: await results.write(matchId(req.params), adminId(res.locals), adminResultEntrySchema.parse(req.body), 'ADMIN_ENTRY', requestId(res.locals)) }); } catch (error) { next(error); }
};
export const correctResult: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await results.write(matchId(req.params), adminId(res.locals), adminResultEntrySchema.parse(req.body), 'ADMIN_CORRECTION', requestId(res.locals)) }); } catch (error) { next(error); }
};
export const resultProblems: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await results.problems(adminResultProblemQuerySchema.parse(req.query)) }); } catch (error) { next(error); }
};
export const resolveResultProblem: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await results.resolveProblem(String(req.params.reportId), adminId(res.locals), resolveResultProblemSchema.parse(req.body), requestId(res.locals)) }); } catch (error) { next(error); }
};
export const refereeReport: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await results.refereeReport(adminRefereeReportQuerySchema.parse(req.query)) }); } catch (error) { next(error); }
};
