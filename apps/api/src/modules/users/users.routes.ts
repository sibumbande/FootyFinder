import { Router, type Router as ExpressRouter } from 'express';
import { requireAuth } from '../../middleware/require-auth.js';
import { list, me } from './users.controller.js';
export const usersRouter: ExpressRouter = Router();
usersRouter.use(requireAuth);
usersRouter.get('/', list);
usersRouter.get('/me', me);
