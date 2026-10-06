import { describe, expect, it } from 'vitest';
import { demoPaymentsEnabled } from './payment-config.js';

describe('demo payment operator gating (TKT-603)', () => {
  it('is enabled only in development/test with the demo provider', () => {
    expect(demoPaymentsEnabled({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'demo' })).toBe(true);
    expect(demoPaymentsEnabled({ NODE_ENV: 'test', PAYMENT_PROVIDER: 'demo' })).toBe(true);
    expect(demoPaymentsEnabled({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'demo' })).toBe(false);
    expect(demoPaymentsEnabled({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'paystack' })).toBe(false);
  });
});
