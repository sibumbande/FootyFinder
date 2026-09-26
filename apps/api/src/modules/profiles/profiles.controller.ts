import { photoCropSchema, updatePlayerProfileSchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { UsersService } from '../users/users.service.js';
import { z } from 'zod';
import { PlayerPhotoService } from './player-photo.service.js';

const users = new UsersService();
const photos = new PlayerPhotoService();
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
export const uploadMyPhoto: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await photos.replace(String(res.locals.authUserId), req.file, photoCropSchema.parse(req.body)) });
  } catch (error) { next(error); }
};
export const getPhoto: RequestHandler = async (req, res, next) => {
  try { res.type('image/webp').sendFile(await photos.filePath(String(req.params.userId))); } catch (error) { next(error); }
};
export const hidePhoto: RequestHandler = async (req, res, next) => {
  try {
    const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
    res.json({ data: await photos.hide(String(req.params.userId), String(res.locals.authUserId), reason, String(res.locals.requestId)) });
  } catch (error) { next(error); }
};
