import type { RequestHandler } from 'express';
import { NotificationsService } from './notifications.service.js';
const service = new NotificationsService();
const userId = (locals: Record<string, unknown>) => String(locals.authUserId);
export const list: RequestHandler = async (_req, res, next) => {
  try {
    res.json({ data: await service.list(userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
export const markRead: RequestHandler = async (req, res, next) => {
  try {
    await service.markRead(String(req.params.id), userId(res.locals));
    res.json({ data: { success: true } });
  } catch (error) {
    next(error);
  }
};
export const markAllRead: RequestHandler = async (_req, res, next) => {
  try {
    await service.markAllRead(userId(res.locals));
    res.json({ data: { success: true } });
  } catch (error) {
    next(error);
  }
};
