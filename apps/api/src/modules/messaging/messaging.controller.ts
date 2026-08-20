import { sendDirectMessageSchema, startConversationSchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { MessagingService } from './messaging.service.js';
const service = new MessagingService();
const userId = (locals: Record<string, unknown>) => String(locals.authUserId);
export const list: RequestHandler = async (_req, res, next) => {
  try {
    res.json({ data: await service.list(userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
export const start: RequestHandler = async (req, res, next) => {
  try {
    res
      .status(201)
      .json({
        data: await service.start(
          userId(res.locals),
          startConversationSchema.parse(req.body).userId,
        ),
      });
  } catch (error) {
    next(error);
  }
};
export const get: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.get(String(req.params.id), userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
export const send: RequestHandler = async (req, res, next) => {
  try {
    res
      .status(201)
      .json({
        data: await service.send(
          String(req.params.id),
          userId(res.locals),
          sendDirectMessageSchema.parse(req.body).content,
        ),
      });
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
