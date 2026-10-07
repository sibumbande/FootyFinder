import { env } from '../../config/env.js';

type PaymentEnv = Pick<typeof env, 'NODE_ENV' | 'PAYMENT_PROVIDER'>;
type ProviderEnv = PaymentEnv & Pick<typeof env, 'PAYSTACK_SECRET_KEY' | 'PAYFAST_MERCHANT_ID' | 'PAYFAST_MERCHANT_KEY' | 'PAYFAST_PASSPHRASE'>;

/** The provider recorded on a ProviderPayment; refunds and verification always use the one the payment was made with. */
export type PaymentProviderName = 'demo' | 'paystack' | 'payfast';

/**
 * DEC-011 / TKT-603: the auto-success demo payment operator exists only in development and test. DEC-021: with it,
 * a ticket checkout is confirmed straight away instead of going to a hosted checkout.
 */
export const demoPaymentsEnabled = (config: PaymentEnv = env) =>
  config.NODE_ENV !== 'production' && config.PAYMENT_PROVIDER === 'demo';

/**
 * The provider a new ticket payment goes to, or null when card payments are not set up in this environment (a match
 * credit or a free place still works). PayFast needs its merchant id, key and passphrase; Paystack its secret key.
 */
export const livePaymentProvider = (config: ProviderEnv = env): PaymentProviderName | null => {
  if (demoPaymentsEnabled(config)) return 'demo';
  if (config.PAYMENT_PROVIDER === 'payfast')
    return config.PAYFAST_MERCHANT_ID && config.PAYFAST_MERCHANT_KEY && config.PAYFAST_PASSPHRASE ? 'payfast' : null;
  if (config.PAYMENT_PROVIDER === 'paystack') return config.PAYSTACK_SECRET_KEY ? 'paystack' : null;
  return null;
};
