import { Router, type Router as ExpressRouter } from 'express';
import { requireAuth } from '../../middleware/require-auth.js';
import { registerUuidRouteParams } from '../../middleware/route-params.js';
import { getProfile, updateMyProfile } from './profiles.controller.js';

export const profilesRouter: ExpressRouter = Router();
registerUuidRouteParams(profilesRouter, ['userId']);
profilesRouter.get('/:userId', getProfile);
profilesRouter.patch('/me/profile', requireAuth, updateMyProfile);
