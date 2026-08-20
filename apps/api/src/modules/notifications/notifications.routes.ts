import { Router, type Router as ExpressRouter } from 'express';
import * as controller from './notifications.controller.js';
export const notificationsRouter: ExpressRouter = Router();
notificationsRouter.get('/', controller.list);
notificationsRouter.post('/read-all', controller.markAllRead);
notificationsRouter.post('/:id/read', controller.markRead);
