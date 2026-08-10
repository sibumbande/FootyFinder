import { Router, type Router as ExpressRouter } from 'express';
import { demoDeposit } from './wallet.controller.js';

export const walletRouter: ExpressRouter = Router();
walletRouter.post('/deposits/demo', demoDeposit);
