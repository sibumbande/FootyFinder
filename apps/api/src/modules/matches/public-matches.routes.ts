import { MATCH_FORMATS, publicMatchSlugSchema } from '@footy-finder/shared';
import { z } from 'zod';
import { Router, type Router as ExpressRouter } from 'express';
import { publicPreviewRateLimit } from '../../middleware/rate-limit.js';
import { MatchesService } from './matches.service.js';

export const publicMatchesRouter: ExpressRouter = Router();
const service = new MatchesService();

// Gate 9 / TKT-910: upcoming public matches for guests (venue, time, format, fee, places left; no names).
publicMatchesRouter.get('/', publicPreviewRateLimit, async (req, res, next) => {
  try {
    const { format } = z.object({ format: z.enum(MATCH_FORMATS).optional() }).parse(req.query);
    res.json({ data: await service.publicList({ format }) });
  } catch (error) {
    next(error);
  }
});

// CEO touch-up batch 2, item 5: the same guest-safe view for a guest who opens a /matches/:id link.
publicMatchesRouter.get('/by-id/:id', publicPreviewRateLimit, async (req, res, next) => {
  try {
    res.json({ data: await service.publicPreviewById(z.string().uuid().parse(req.params.id)) });
  } catch (error) {
    next(error);
  }
});

publicMatchesRouter.get('/:slug', publicPreviewRateLimit, async (req, res, next) => {
  try {
    res.json({ data: await service.publicPreview(publicMatchSlugSchema.parse(req.params.slug)) });
  } catch (error) {
    next(error);
  }
});
