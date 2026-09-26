import { LEGAL_DOCUMENT_TYPES } from '@footy-finder/shared';
import { Router, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { LegalService } from './legal.service.js';

export const legalRouter: ExpressRouter = Router();
const service = new LegalService();
legalRouter.get('/documents/current', async (_req, res, next) => {
  try { res.json({ data: await service.listCurrent() }); } catch (error) { next(error); }
});
legalRouter.get('/documents/:type', async (req, res, next) => {
  try {
    const type = z.enum(LEGAL_DOCUMENT_TYPES).parse(req.params.type);
    res.json({ data: await service.getCurrent(type) });
  } catch (error) { next(error); }
});
