import { adminCancelMatchSchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { AdminMatchCancelService } from './admin-match-cancel.service.js';

const service = new AdminMatchCancelService();

/** CEO Q4: POST /admin/matches/:matchId/cancel (fresh MFA on the route). */
export const cancelMatch: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await service.cancel(
        String(req.params.matchId),
        String(res.locals.authUserId),
        adminCancelMatchSchema.parse(req.body),
        String(res.locals.requestId),
      ),
    });
  } catch (error) {
    next(error);
  }
};
