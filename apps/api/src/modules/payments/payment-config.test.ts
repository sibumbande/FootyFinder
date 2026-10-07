import { describe, expect, it } from 'vitest';
import { demoPaymentsEnabled, livePaymentProvider } from './payment-config.js';

describe('demo payment operator gating (TKT-603)', () => {
  it('is enabled only in development/test with the demo provider', () => {
    expect(demoPaymentsEnabled({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'demo' })).toBe(true);
    expect(demoPaymentsEnabled({ NODE_ENV: 'test', PAYMENT_PROVIDER: 'demo' })).toBe(true);
    expect(demoPaymentsEnabled({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'demo' })).toBe(false);
    expect(demoPaymentsEnabled({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'paystack' })).toBe(false);
  });
});

describe('the provider new ticket payments go to', () => {
  const none = { PAYSTACK_SECRET_KEY: undefined, PAYFAST_MERCHANT_ID: undefined, PAYFAST_MERCHANT_KEY: undefined, PAYFAST_PASSPHRASE: undefined };
  const payfast = { PAYFAST_MERCHANT_ID: '10000100', PAYFAST_MERCHANT_KEY: 'key', PAYFAST_PASSPHRASE: 'passphrase' };
  it('is the configured provider only when its credentials are all there', () => {
    expect(livePaymentProvider({ ...none, NODE_ENV: 'development', PAYMENT_PROVIDER: 'demo' })).toBe('demo');
    expect(livePaymentProvider({ ...none, NODE_ENV: 'development', PAYMENT_PROVIDER: 'paystack', PAYSTACK_SECRET_KEY: 'sk_test_x' })).toBe('paystack');
    expect(livePaymentProvider({ ...none, NODE_ENV: 'development', PAYMENT_PROVIDER: 'paystack' })).toBeNull();
    expect(livePaymentProvider({ ...none, ...payfast, NODE_ENV: 'development', PAYMENT_PROVIDER: 'payfast' })).toBe('payfast');
    expect(livePaymentProvider({ ...none, ...payfast, NODE_ENV: 'development', PAYMENT_PROVIDER: 'payfast', PAYFAST_PASSPHRASE: undefined })).toBeNull();
    // Paystack credentials alone never make PayFast (or the other way round) the provider.
    expect(livePaymentProvider({ ...none, NODE_ENV: 'development', PAYMENT_PROVIDER: 'payfast', PAYSTACK_SECRET_KEY: 'sk_test_x' })).toBeNull();
  });
});
