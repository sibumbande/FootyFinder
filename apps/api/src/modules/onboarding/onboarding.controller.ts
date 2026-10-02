import {
  completeOnboardingSchema,
  legalAcceptanceSchema,
  onboardingGenderSchema,
  onboardingProfileSchema,
} from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { OnboardingService } from './onboarding.service.js';

const service = new OnboardingService();
const userId = (locals: Record<string, unknown>) => String(locals.authUserId);

export const status: RequestHandler = async (_req, res, next) => {
  try { res.json({ data: await service.status(userId(res.locals)) }); } catch (error) { next(error); }
};
export const saveProfile: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await service.saveProfile(userId(res.locals), onboardingProfileSchema.parse(req.body)) }); } catch (error) { next(error); }
};
/** CEO touch-up batch 4, item 1. */
export const saveGender: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await service.setGender(userId(res.locals), onboardingGenderSchema.parse(req.body).gender) }); } catch (error) { next(error); }
};
export const acceptLegal: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.acceptLegal(userId(res.locals), legalAcceptanceSchema.parse(req.body), { ip: req.ip, userAgent: req.get('user-agent') }) });
  } catch (error) { next(error); }
};
export const complete: RequestHandler = async (req, res, next) => {
  try {
    completeOnboardingSchema.parse(req.body);
    res.json({ data: await service.complete(userId(res.locals)) });
  } catch (error) { next(error); }
};
