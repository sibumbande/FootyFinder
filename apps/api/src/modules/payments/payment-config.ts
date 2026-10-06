import { env } from '../../config/env.js';

type PaymentEnv = Pick<typeof env, 'NODE_ENV' | 'PAYMENT_PROVIDER'>;

/**
 * DEC-011 / TKT-603: the auto-success demo payment operator exists only in development and test. DEC-021: with it,
 * a ticket checkout is confirmed straight away instead of going to Paystack's hosted checkout.
 */
export const demoPaymentsEnabled = (config: PaymentEnv = env) =>
  config.NODE_ENV !== 'production' && config.PAYMENT_PROVIDER === 'demo';
