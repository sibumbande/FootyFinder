import { Router, type Router as ExpressRouter } from 'express';
import { requireAuth, requireSession } from '../../middleware/require-auth.js';
import { list, me } from './users.controller.js';
export const usersRouter: ExpressRouter = Router();
usersRouter.get('/', requireAuth, list);
usersRouter.get('/me', requireSession, me);
