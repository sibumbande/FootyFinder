import { venueSlotsQuerySchema, venueSlugSchema } from '@footy-finder/shared';
import { Router, type Router as ExpressRouter } from 'express';
import { VenuesService } from './venues.service.js';

export const venuesRouter: ExpressRouter = Router();
const service = new VenuesService();
venuesRouter.get('/', async (_req, res, next) => { try { res.json({ data: await service.list() }); } catch (error) { next(error); } });
venuesRouter.get('/:slug/slots', async (req, res, next) => {
  try { res.json({ data: await service.slots(venueSlugSchema.parse(req.params.slug), venueSlotsQuerySchema.parse(req.query)) }); } catch (error) { next(error); }
});
venuesRouter.get('/:slug', async (req, res, next) => {
  try { res.json({ data: await service.get(venueSlugSchema.parse(req.params.slug)) }); } catch (error) { next(error); }
});
