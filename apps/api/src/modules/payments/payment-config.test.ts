import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../../middleware/error-handler.js';
import { demoDepositsEnabled, requireDemoDeposits, topUpOptions } from './payment-config.js';

describe('demo payment operator gating (TKT-603)', () => {
  it('is enabled only in development/test with the demo provider', () => {
    expect(demoDepositsEnabled({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'demo' })).toBe(true);
    expect(demoDepositsEnabled({ NODE_ENV: 'test', PAYMENT_PROVIDER: 'demo' })).toBe(true);
    expect(demoDepositsEnabled({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'demo' })).toBe(false);
    expect(demoDepositsEnabled({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'paystack' })).toBe(false);
  });

  it('answers 404 for the demo route in production', async () => {
    const app = (NODE_ENV: 'production' | 'test') =>
      express()
        .post('/demo', requireDemoDeposits(() => ({ NODE_ENV, PAYMENT_PROVIDER: 'demo' })), (_req, res) => {
          res.json({ data: 'credited' });
        })
        .use(errorHandler);
    expect((await request(app('production')).post('/demo')).status).toBe(404);
    expect((await request(app('test')).post('/demo')).status).toBe(200);
  });

  it('publishes the R50–R5,000 range, the R200/R400/R800 quick picks and the configured methods', () => {
    expect(topUpOptions({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'demo', PAYSTACK_CHANNELS: ['card', 'capitec_pay', 'eft'] })).toEqual({
      provider: 'demo',
      minCents: 5_000,
      maxCents: 500_000,
      quickPickCents: [20_000, 40_000, 80_000],
      defaultCents: 40_000,
      channels: ['card', 'capitec_pay', 'eft'],
    });
    expect(topUpOptions({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'paystack' }).provider).toBe('paystack');
  });
});
