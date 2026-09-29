import { Router, type Router as ExpressRouter } from 'express';
import { demoDeposit, summary, transactions } from './wallet.controller.js';
import { costlyMutationRateLimit } from '../../middleware/rate-limit.js';

export const walletRouter: ExpressRouter = Router();
walletRouter.get('/', summary);
walletRouter.get('/transactions', transactions);
walletRouter.post('/deposits/demo', costlyMutationRateLimit, demoDeposit);
