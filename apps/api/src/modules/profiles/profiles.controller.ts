import { updatePlayerProfileSchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { UsersService } from '../users/users.service.js';

const users = new UsersService();
export const getProfile: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await users.get(String(req.params.userId)) });
  } catch (error) {
    next(error);
  }
};
export const updateMyProfile: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await users.updateProfile(
        String(res.locals.authUserId),
        updatePlayerProfileSchema.parse(req.body),
      ),
    });
  } catch (error) {
    next(error);
  }
};
