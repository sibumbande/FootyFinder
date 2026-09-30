import { declineRefereeSchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { RefereeAssignmentService } from './referee-assignment.service.js';

const assignments = new RefereeAssignmentService();
const userId = (locals: Record<string, unknown>) => String(locals.authUserId);

/** D16: the assigned referee declines a match, until T-30. */
export const decline: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await assignments.decline(String(req.params.matchId), userId(res.locals), declineRefereeSchema.parse(req.body)) }); } catch (error) { next(error); }
};
