import type { RequestHandler } from 'express';
import { UsersService } from './users.service.js';

const service = new UsersService();
export const me: RequestHandler = async (_req, res, next) => {
  try {
    res.json({ data: await service.me(String(res.locals.authUserId)) });
  } catch (error) {
    next(error);
  }
};
export const list: RequestHandler = async (_req, res, next) => {
  try {
    res.json({ data: await service.list() });
  } catch (error) {
    next(error);
  }
};
