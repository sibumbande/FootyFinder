import { DEMO_DEPOSIT_CENTS } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { DemoPaymentOperator } from './demo-payment.operator.js';
import { DepositsService } from './deposits.service.js';

const deposits = new DepositsService(new DemoPaymentOperator());

export const demoDeposit: RequestHandler = async (req, res, next) => {
  try {
    const idempotencyKey = String(req.header('Idempotency-Key') ?? '');
    const data = await deposits.deposit(String(res.locals.authUserId), DEMO_DEPOSIT_CENTS, idempotencyKey);
    res.json({ data });
  } catch (error) {
    next(error);
  }
};
