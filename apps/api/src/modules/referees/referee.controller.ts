import { declineRefereeSchema, refereeResultSchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { RefereeAssignmentService } from './referee-assignment.service.js';
import { RefereeResultsService } from './referee-results.service.js';

const assignments = new RefereeAssignmentService();
const results = new RefereeResultsService();
const userId = (locals: Record<string, unknown>) => String(locals.authUserId);

/** D16: the assigned referee declines a match, until T-30. */
export const decline: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await assignments.decline(String(req.params.matchId), userId(res.locals), declineRefereeSchema.parse(req.body)) }); } catch (error) { next(error); }
};
/** Gate 8 / TKT-804: the referee records the final result (D5, D12). */
export const submitResult: RequestHandler = async (req, res, next) => {
  try { res.status(201).json({ data: await results.submit(String(req.params.matchId), userId(res.locals), refereeResultSchema.parse(req.body)) }); } catch (error) { next(error); }
};
