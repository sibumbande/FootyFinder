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

  it('publishes the R50–R5,000 range and the quick picks', () => {
    expect(topUpOptions({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'demo' })).toEqual({
      provider: 'demo',
      minCents: 5_000,
      maxCents: 500_000,
      quickPickCents: [8_000, 16_000, 24_000, 40_000],
      defaultCents: 16_000,
    });
    expect(topUpOptions({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'paystack' }).provider).toBe('paystack');
  });
});
