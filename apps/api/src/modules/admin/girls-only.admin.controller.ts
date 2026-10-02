import { adminCorrectGenderSchema, adminGirlsOnlySchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { GirlsOnlyAdminService } from './girls-only.admin.service.js';

const service = new GirlsOnlyAdminService();

// CEO touch-up batch 4, item 1: fresh MFA on both routes; audited.
export const setGirlsOnly: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.setMatch(String(req.params.matchId), adminGirlsOnlySchema.parse(req.body), String(res.locals.authUserId), String(res.locals.requestId)) });
  } catch (error) {
    next(error);
  }
};

export const correctGender: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.correctGender(String(req.params.userId), adminCorrectGenderSchema.parse(req.body), String(res.locals.authUserId), String(res.locals.requestId)) });
  } catch (error) {
    next(error);
  }
};
