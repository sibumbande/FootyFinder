import type { RequestHandler } from 'express';
import { OnboardingService } from '../modules/onboarding/onboarding.service.js';

const onboarding = new OnboardingService();

export const requireOnboardingForMutations: RequestHandler = async (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  try {
    await onboarding.assertProductAccess(String(res.locals.authUserId));
    next();
  } catch (error) {
    next(error);
  }
};
