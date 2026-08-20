import { DEMO_DEPOSIT_CENTS } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { NotificationsService } from '../notifications/notifications.service.js';
import { DemoPaymentOperator } from './demo-payment.operator.js';
import { DepositsService } from './deposits.service.js';

const deposits = new DepositsService(new DemoPaymentOperator());
const notifications = new NotificationsService();

export const demoDeposit: RequestHandler = async (req, res, next) => {
  try {
    const idempotencyKey = String(req.header('Idempotency-Key') ?? '');
    const data = await deposits.deposit(
      String(res.locals.authUserId),
      DEMO_DEPOSIT_CENTS,
      idempotencyKey,
    );
    if (data.status === 'success' && !data.replayed) await notifications.create(String(res.locals.authUserId), 'DEPOSIT_SUCCEEDED', 'Deposit received', 'R500.00 was added to your Footy Finder wallet.', '/');
    res.json({ data });
  } catch (error) {
    next(error);
  }
};
