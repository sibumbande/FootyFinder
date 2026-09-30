import { captainResultSchema, reportResultProblemSchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { ResultEvidenceService } from './result-evidence.service.js';

const evidence = new ResultEvidenceService();
const userId = (locals: Record<string, unknown>) => String(locals.authUserId);
const matchId = (params: Record<string, unknown>) => String(params.id);

/** Gate 8 / TKT-806: the viewer's result context, own version (D10, D11) and problem report (D6). */
export const resultContext: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await evidence.context(matchId(req.params), userId(res.locals)) }); } catch (error) { next(error); }
};
export const submitVersion: RequestHandler = async (req, res, next) => {
  try { res.status(201).json({ data: await evidence.submitVersion(matchId(req.params), userId(res.locals), captainResultSchema.parse(req.body)) }); } catch (error) { next(error); }
};
export const reportProblem: RequestHandler = async (req, res, next) => {
  try { res.status(201).json({ data: await evidence.reportProblem(matchId(req.params), userId(res.locals), reportResultProblemSchema.parse(req.body)) }); } catch (error) { next(error); }
};
