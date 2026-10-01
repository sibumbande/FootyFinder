import { leaderboardQuerySchema, recruitmentQuerySchema } from '@footy-finder/shared';
import { Router, type RequestHandler, type Router as ExpressRouter } from 'express';
import { publicPreviewRateLimit } from '../../middleware/rate-limit.js';
import { registerUuidRouteParams } from '../../middleware/route-params.js';
import { optionalSession } from '../../middleware/require-auth.js';
import { LeaderboardsService } from '../leaderboards/leaderboards.service.js';
import { RecruitmentService } from '../social/recruitment.service.js';
import { PublicBrowseService } from './public-browse.service.js';

const browse = new PublicBrowseService();
const recruitment = new RecruitmentService();
const leaderboards = new LeaderboardsService();
const handle = (work: (req: Parameters<RequestHandler>[0]) => Promise<unknown>): RequestHandler => async (req, res, next) => {
  try {
    res.json({ data: await work(req) });
  } catch (error) {
    next(error);
  }
};

/**
 * Gate 9 / TKT-910: read-only guest browsing, with no account. Every response is the guest-safe
 * version whether or not a session cookie is sent; signed-in pages keep using their own routes.
 * Rate-limited per IP like the public match preview.
 */
export const publicRouter: ExpressRouter = Router();
registerUuidRouteParams(publicRouter, ['teamId', 'userId']);
publicRouter.use(publicPreviewRateLimit);
publicRouter.get('/teams/:teamId', handle((req) => browse.team(String(req.params.teamId))));
publicRouter.get('/players/:userId', handle((req) => browse.player(String(req.params.userId))));
publicRouter.get('/recruitment/posts', handle((req) => recruitment.listPosts(null, recruitmentQuerySchema.parse(req.query))));
publicRouter.get('/recruitment/looking', handle((req) => recruitment.listLooking(null, recruitmentQuerySchema.parse(req.query))));
// CEO touch-up batch 3.5, item 6: leaderboards are public (guests too); a signed-in viewer also gets their own place.
publicRouter.get('/leaderboards', optionalSession, async (req, res, next) => {
  try {
    const viewerId = typeof res.locals.authUserId === 'string' ? res.locals.authUserId : null;
    res.json({ data: await leaderboards.get(leaderboardQuerySchema.parse(req.query), viewerId) });
  } catch (error) {
    next(error);
  }
});
