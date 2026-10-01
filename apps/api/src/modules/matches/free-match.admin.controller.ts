import { adminFreeMatchSchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { FreeMatchAdminService } from './free-match.admin.service.js';

const service = new FreeMatchAdminService();

// CEO touch-up batch 3, item 5: mark/unmark a free match (fresh MFA on the route) and the cost report.
export const markFreeMatch: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.mark(String(req.params.matchId), adminFreeMatchSchema.parse(req.body), String(res.locals.authUserId), String(res.locals.requestId)) });
  } catch (error) {
    next(error);
  }
};

export const freeMatchCosts: RequestHandler = async (_req, res, next) => {
  try {
    res.json({ data: await service.costReport() });
  } catch (error) {
    next(error);
  }
};
