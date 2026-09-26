import { Router, type Router as ExpressRouter } from 'express';
import { requireSession } from '../../middleware/require-auth.js';
import { acceptLegal, complete, saveProfile, status } from './onboarding.controller.js';

export const onboardingRouter: ExpressRouter = Router();
onboardingRouter.use(requireSession);
onboardingRouter.get('/status', status);
onboardingRouter.put('/profile', saveProfile);
onboardingRouter.post('/legal-acceptance', acceptLegal);
onboardingRouter.post('/complete', complete);
