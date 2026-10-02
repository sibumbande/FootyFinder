import { Router, type Router as ExpressRouter } from 'express';
import { authRateLimit } from '../../middleware/rate-limit.js';
import * as controller from './account.controller.js';

/**
 * CEO batch 5: the player's own account (deletion, data download). Mounted behind requireSession so a
 * player who has not finished onboarding can still use their POPIA rights; the preview blocks restricted
 * accounts itself.
 */
export const accountRouter: ExpressRouter = Router();
accountRouter.get('/deletion/preview', controller.deletionPreview);
accountRouter.post('/deletion', authRateLimit, controller.requestDeletion);
accountRouter.post('/data-export', authRateLimit, controller.downloadData);
