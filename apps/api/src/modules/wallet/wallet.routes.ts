import { Router, type Router as ExpressRouter } from 'express';
import {
  demoDeposit,
  options,
  startTopUp,
  summary,
  topUpStatus,
  transactions,
  undoableTopUps,
  undoTopUp,
} from './wallet.controller.js';
import { requireDemoDeposits } from './payment-config.js';
import { reclaimable } from '../team-wallet/team-wallet.controller.js';
import { costlyMutationRateLimit, createRateLimit } from '../../middleware/rate-limit.js';

// The return page polls its status; each poll may re-verify with Paystack (at most every 5 s).
const topUpStatusRateLimit = createRateLimit({ scope: 'top-up-status', limit: 60, windowMs: 60_000 });

export const walletRouter: ExpressRouter = Router();
walletRouter.get('/', summary);
walletRouter.get('/transactions', transactions);
// Gate 7 / D8: teams where the caller still has unspent contributions (including teams they left).
walletRouter.get('/team-contributions', reclaimable);
walletRouter.get('/top-up-options', options);
walletRouter.post('/top-ups', costlyMutationRateLimit, startTopUp);
// CEO touch-up batch 3, item 6b: undo a recent top-up (refund to the same card), once per top-up.
walletRouter.get('/top-ups/undoable', undoableTopUps);
walletRouter.post('/top-ups/:paymentId/undo', costlyMutationRateLimit, undoTopUp);
walletRouter.get('/top-ups/:reference', topUpStatusRateLimit, topUpStatus);
walletRouter.post('/deposits/demo', requireDemoDeposits(), costlyMutationRateLimit, demoDeposit);
