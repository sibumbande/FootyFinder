import { Router, type Router as ExpressRouter } from 'express';
import { requireSession } from '../../middleware/require-auth.js';
import { acceptLegal, complete, saveGender, saveProfile, status } from './onboarding.controller.js';

export const onboardingRouter: ExpressRouter = Router();
onboardingRouter.use(requireSession);
onboardingRouter.get('/status', status);
onboardingRouter.put('/profile', saveProfile);
onboardingRouter.put('/gender', saveGender);
onboardingRouter.post('/legal-acceptance', acceptLegal);
onboardingRouter.post('/complete', complete);
