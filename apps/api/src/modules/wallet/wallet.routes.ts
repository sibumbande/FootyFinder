import { Router, type Router as ExpressRouter } from 'express';
import { demoDeposit } from './wallet.controller.js';
import { costlyMutationRateLimit } from '../../middleware/rate-limit.js';

export const walletRouter: ExpressRouter = Router();
walletRouter.post('/deposits/demo', costlyMutationRateLimit, demoDeposit);
