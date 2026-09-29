import { DEMO_DEPOSIT_CENTS, walletHistoryQuerySchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { DemoPaymentOperator } from './demo-payment.operator.js';
import { DepositsService } from './deposits.service.js';
import { WalletHistoryService } from './wallet-history.service.js';

const deposits = new DepositsService(new DemoPaymentOperator());
const history = new WalletHistoryService();
const userId = (locals: Record<string, unknown>) => String(locals.authUserId);

export const summary: RequestHandler = async (_req, res, next) => {
  try {
    res.json({ data: await history.summary(userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};

export const transactions: RequestHandler = async (req, res, next) => {
  try {
    const query = walletHistoryQuerySchema.parse(req.query);
    res.json({ data: await history.history(userId(res.locals), query) });
  } catch (error) {
    next(error);
  }
};

export const demoDeposit: RequestHandler = async (req, res, next) => {
  try {
    const idempotencyKey = String(req.header('Idempotency-Key') ?? '');
    const data = await deposits.deposit(
      userId(res.locals),
      DEMO_DEPOSIT_CENTS,
      idempotencyKey,
    );
    res.json({ data });
  } catch (error) {
    next(error);
  }
};
