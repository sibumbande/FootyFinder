import { Router, type Router as ExpressRouter } from 'express';
import * as controller from './messaging.controller.js';
export const messagingRouter: ExpressRouter = Router();
messagingRouter.get('/', controller.list);
messagingRouter.post('/', controller.start);
messagingRouter.get('/:id', controller.get);
messagingRouter.post('/:id/messages', controller.send);
messagingRouter.post('/:id/read', controller.markRead);
