import { topUpAmountSchema, walletHistoryQuerySchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { DemoPaymentOperator } from './demo-payment.operator.js';
import { DepositsService } from './deposits.service.js';
import { topUpOptions } from './payment-config.js';
import { WalletHistoryService } from './wallet-history.service.js';
import { AppError } from '../../errors/app-error.js';
import { TopUpService } from '../payments/top-up.service.js';

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

export const options: RequestHandler = (_req, res) => {
  res.json({ data: topUpOptions() });
};

/** Development/test only (see requireDemoDeposits): credits immediately without a card. */
export const demoDeposit: RequestHandler = async (req, res, next) => {
  try {
    const idempotencyKey = String(req.header('Idempotency-Key') ?? '');
    const { amountCents } = topUpAmountSchema.parse(req.body ?? {});
    const data = await deposits.deposit(userId(res.locals), amountCents, idempotencyKey);
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

const topUps = new TopUpService();
const topUpReference = /^ff_topup_[0-9a-f]{32}$/;

/** TKT-604: starts a Paystack hosted-checkout card top-up. Never credits the wallet itself. */
export const startTopUp: RequestHandler = async (req, res, next) => {
  try {
    const idempotencyKey = String(req.header('Idempotency-Key') ?? '');
    const { amountCents } = topUpAmountSchema.parse(req.body ?? {});
    res.status(201).json({ data: await topUps.initiate(userId(res.locals), amountCents, idempotencyKey) });
  } catch (error) {
    next(error);
  }
};

export const topUpStatus: RequestHandler = async (req, res, next) => {
  try {
    const reference = String(req.params.reference ?? '');
    if (!topUpReference.test(reference))
      throw new AppError(404, 'Top-up not found.', 'TOP_UP_NOT_FOUND');
    res.json({ data: await topUps.status(userId(res.locals), reference) });
  } catch (error) {
    next(error);
  }
};
