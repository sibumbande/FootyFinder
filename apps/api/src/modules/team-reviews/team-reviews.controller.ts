import { adminTeamReviewQuerySchema, moderateTeamReviewSchema, teamReviewInputSchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { TeamReviewsService } from './team-reviews.service.js';

const reviews = new TeamReviewsService();
const userId = (locals: Record<string, unknown>) => String(locals.authUserId);
const requestId = (locals: Record<string, unknown>) => String(locals.requestId);

/** Gate 8 / TKT-809 (DEC-017): reviews of the opposing team after a final result. */
export const context: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await reviews.context(String(req.params.id), userId(res.locals)) }); } catch (error) { next(error); }
};
export const create: RequestHandler = async (req, res, next) => {
  try { res.status(201).json({ data: await reviews.create(String(req.params.id), userId(res.locals), teamReviewInputSchema.parse(req.body)) }); } catch (error) { next(error); }
};
export const update: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await reviews.update(String(req.params.id), userId(res.locals), teamReviewInputSchema.parse(req.body)) }); } catch (error) { next(error); }
};
export const remove: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await reviews.remove(String(req.params.id), userId(res.locals)) }); } catch (error) { next(error); }
};
export const teamSummary: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await reviews.teamSummary(String(req.params.teamId)) }); } catch (error) { next(error); }
};
export const report: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await reviews.report(String(req.params.teamId), String(req.params.reviewId), userId(res.locals)) }); } catch (error) { next(error); }
};
export const adminList: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await reviews.adminList(adminTeamReviewQuerySchema.parse(req.query)) }); } catch (error) { next(error); }
};
export const moderate: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await reviews.moderate(String(req.params.reviewId), userId(res.locals), moderateTeamReviewSchema.parse(req.body), requestId(res.locals)) }); } catch (error) { next(error); }
};
