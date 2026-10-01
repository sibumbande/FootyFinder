import { cityInterestSchema, cityInterestStatusSchema } from '@footy-finder/shared';
import { Router, type Router as ExpressRouter } from 'express';
import { optionalSession } from '../../middleware/require-auth.js';
import { authRateLimit } from '../../middleware/rate-limit.js';
import { CitiesService } from './cities.service.js';

export const citiesRouter: ExpressRouter = Router();
const service = new CitiesService();
citiesRouter.get('/', async (_req, res, next) => {
  try { res.json({ data: await service.list() }); } catch (error) { next(error); }
});
citiesRouter.post('/interests', optionalSession, authRateLimit, async (req, res, next) => {
  try {
    res.status(201).json({ data: await service.joinInterest(cityInterestSchema.parse(req.body), typeof res.locals.authUserId === 'string' ? res.locals.authUserId : undefined) });
  } catch (error) { next(error); }
});
citiesRouter.post('/interests/status', authRateLimit, async (req, res, next) => {
  try { res.json({ data: await service.status(cityInterestStatusSchema.parse(req.body).token) }); } catch (error) { next(error); }
});
citiesRouter.post('/interests/unsubscribe', authRateLimit, async (req, res, next) => {
  try { res.json({ data: await service.unsubscribe(cityInterestStatusSchema.parse(req.body).token) }); } catch (error) { next(error); }
});
citiesRouter.delete('/interests', authRateLimit, async (req, res, next) => {
  try { res.json({ data: await service.remove(cityInterestStatusSchema.parse(req.body).token) }); } catch (error) { next(error); }
});
