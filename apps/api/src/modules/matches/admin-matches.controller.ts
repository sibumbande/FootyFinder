import { adminCreateMatchSchema, adminMatchListQuerySchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { BookingsService } from '../bookings/bookings.service.js';
import { AdminMatchesService } from './admin-matches.service.js';

const service = new AdminMatchesService();
const bookings = new BookingsService();
const actor = (locals: Record<string, unknown>) => String(locals.authUserId);
const requestId = (locals: Record<string, unknown>) => String(locals.requestId);

// CEO touch-up batch 3.5, item 5.
export const listAdminMatches: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.list(adminMatchListQuerySchema.parse(req.query)) });
  } catch (error) {
    next(error);
  }
};

export const adminMatchDetail: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.detail(String(req.params.matchId)) });
  } catch (error) {
    next(error);
  }
};

/** Fresh MFA (route); audited as MATCH_LOADED with the visibility and free flags. */
export const createAdminMatch: RequestHandler = async (req, res, next) => {
  try {
    res.status(201).json({ data: await bookings.createAdminMatch(adminCreateMatchSchema.parse(req.body), actor(res.locals), requestId(res.locals)) });
  } catch (error) {
    next(error);
  }
};

export const rotateAdminMatchInvite: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.rotateInvite(String(req.params.matchId), actor(res.locals), requestId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
