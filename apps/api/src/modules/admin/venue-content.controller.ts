import { venueContentDecisionSchema, venueContentInputSchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import multer from 'multer';
import { AppError } from '../../errors/app-error.js';
import { VENUE_PHOTO_MAX_BYTES } from '../venues/venue-photo.storage.js';
import { VenueContentService } from './venue-content.service.js';

const service = new VenueContentService();
const actor = (locals: Record<string, unknown>) => String(locals.authUserId);
const requestId = (locals: Record<string, unknown>) => String(locals.requestId);

// CEO touch-up batch 3, item 1: one photo per request; HEIC is refused with a clear message (D3).
export const venuePhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VENUE_PHOTO_MAX_BYTES, files: 1, fields: 2, parts: 3, fieldNameSize: 30, fieldNestingDepth: 0 },
  fileFilter: (_req, file, done) =>
    ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)
      ? done(null, true)
      : done(new AppError(400, 'Upload a JPG, PNG or WebP photo. iPhone HEIC photos: save as JPG first.', 'VENUE_PHOTO_INVALID')),
});

export const uploadVenuePhoto: RequestHandler = async (req, res, next) => {
  try {
    if (!req.file) throw new AppError(400, 'Choose a photo to upload.', 'VENUE_PHOTO_INVALID');
    res.status(201).json({ data: await service.uploadPhoto(String(req.params.venueId), req.file, actor(res.locals), requestId(res.locals)) });
  } catch (error) {
    next(error);
  }
};

export const saveVenueContent: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.saveContent(String(req.params.venueId), venueContentInputSchema.parse(req.body), actor(res.locals), requestId(res.locals)) });
  } catch (error) {
    next(error);
  }
};

export const approveVenueContentChange: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.approveChange(String(req.params.changeId), actor(res.locals), requestId(res.locals)) });
  } catch (error) {
    next(error);
  }
};

export const rejectVenueContentChange: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.rejectChange(String(req.params.changeId), venueContentDecisionSchema.parse(req.body).reason, actor(res.locals), requestId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
