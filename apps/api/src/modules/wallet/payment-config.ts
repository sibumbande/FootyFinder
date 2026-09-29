import {
  TOP_UP_DEFAULT_CENTS,
  TOP_UP_MAX_CENTS,
  TOP_UP_MIN_CENTS,
  TOP_UP_QUICK_PICK_CENTS,
  type TopUpOptions,
} from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { env } from '../../config/env.js';
import { AppError } from '../../errors/app-error.js';

type PaymentEnv = Pick<typeof env, 'NODE_ENV' | 'PAYMENT_PROVIDER'>;

/** DEC-011 / TKT-603: the auto-success demo operator exists only in development and test. */
export const demoDepositsEnabled = (config: PaymentEnv = env) =>
  config.NODE_ENV !== 'production' && config.PAYMENT_PROVIDER === 'demo';

/** Answers 404 (as if the route did not exist) whenever the demo operator is not allowed. */
export const requireDemoDeposits =
  (config: () => PaymentEnv = () => env): RequestHandler =>
  (_req, _res, next) =>
    next(
      demoDepositsEnabled(config())
        ? undefined
        : new AppError(404, 'Not found.', 'NOT_FOUND'),
    );

export const topUpOptions = (config: PaymentEnv = env): TopUpOptions => ({
  provider: demoDepositsEnabled(config) ? 'demo' : 'paystack',
  minCents: TOP_UP_MIN_CENTS,
  maxCents: TOP_UP_MAX_CENTS,
  quickPickCents: [...TOP_UP_QUICK_PICK_CENTS],
  defaultCents: TOP_UP_DEFAULT_CENTS,
});
