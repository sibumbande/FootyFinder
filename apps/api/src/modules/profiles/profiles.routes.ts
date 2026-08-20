import { Router, type Router as ExpressRouter } from 'express';
import { requireAuth } from '../../middleware/require-auth.js';
import { getProfile, updateMyProfile } from './profiles.controller.js';

export const profilesRouter: ExpressRouter = Router();
profilesRouter.get('/:userId', getProfile);
profilesRouter.patch('/me/profile', requireAuth, updateMyProfile);
