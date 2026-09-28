import { publicMatchSlugSchema } from '@footy-finder/shared';
import { Router, type Router as ExpressRouter } from 'express';
import { publicPreviewRateLimit } from '../../middleware/rate-limit.js';
import { MatchesService } from './matches.service.js';

export const publicMatchesRouter: ExpressRouter = Router();
const service = new MatchesService();

publicMatchesRouter.get('/:slug', publicPreviewRateLimit, async (req, res, next) => {
  try {
    res.json({ data: await service.publicPreview(publicMatchSlugSchema.parse(req.params.slug)) });
  } catch (error) {
    next(error);
  }
});
