import { Router, type Router as ExpressRouter } from 'express';
import { demoDeposit, options, summary, transactions } from './wallet.controller.js';
import { requireDemoDeposits } from './payment-config.js';
import { costlyMutationRateLimit } from '../../middleware/rate-limit.js';

export const walletRouter: ExpressRouter = Router();
walletRouter.get('/', summary);
walletRouter.get('/transactions', transactions);
walletRouter.get('/top-up-options', options);
walletRouter.post('/deposits/demo', requireDemoDeposits(), costlyMutationRateLimit, demoDeposit);
