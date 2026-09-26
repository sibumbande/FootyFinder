import { Router, type Router as ExpressRouter } from 'express';
import { requireAuth, requireSession } from '../../middleware/require-auth.js';
import { requireAdminMfa, requirePlatformAdmin } from '../../middleware/require-admin.js';
import { costlyMutationRateLimit } from '../../middleware/rate-limit.js';
import multer from 'multer';
import { AppError } from '../../errors/app-error.js';
import { registerUuidRouteParams } from '../../middleware/route-params.js';
import { getPhoto, getProfile, hidePhoto, updateMyProfile, uploadMyPhoto } from './profiles.controller.js';
import { PLAYER_PHOTO_MAX_BYTES } from './player-photo.storage.js';

export const profilesRouter: ExpressRouter = Router();
export const playerPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PLAYER_PHOTO_MAX_BYTES, files: 1, fields: 3, parts: 4, fieldNameSize: 30, fieldNestingDepth: 0 },
  fileFilter: (_req, file, done) =>
    ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)
      ? done(null, true)
      : done(new AppError(400, 'Upload a JPEG, PNG, or WEBP image.', 'PLAYER_PHOTO_INVALID')),
});
registerUuidRouteParams(profilesRouter, ['userId']);
profilesRouter.get('/:userId', requireAuth, getProfile);
profilesRouter.get('/:userId/photo', requireAuth, getPhoto);
profilesRouter.patch('/me/profile', requireSession, updateMyProfile);
profilesRouter.post('/me/photo', requireSession, costlyMutationRateLimit, playerPhotoUpload.single('image'), uploadMyPhoto);
profilesRouter.post('/:userId/photo/hide', requireAuth, requirePlatformAdmin, requireAdminMfa, hidePhoto);
