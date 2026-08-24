import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createRateLimit, InMemoryRateLimitStore } from './rate-limit.js';

describe('rate limiting', () => {
  it('resets counters after the configured window', () => {
    const store = new InMemoryRateLimitStore();
    expect(store.consume('actor', 1, 1_000, 1_000).allowed).toBe(true);
    expect(store.consume('actor', 1, 1_000, 1_001).allowed).toBe(false);
    expect(store.consume('actor', 1, 1_000, 2_000).allowed).toBe(true);
  });

  it('returns the stable RATE_LIMITED contract and retry metadata', async () => {
    const app = express();
    app.get('/', createRateLimit({ scope: 'test', limit: 1, windowMs: 60_000 }), (_req, res) =>
      res.json({ data: true }),
    );
    expect((await request(app).get('/')).status).toBe(200);
    const blocked = await request(app).get('/');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSeconds: expect.any(Number) },
    });
    expect(blocked.headers['retry-after']).toBeDefined();
  });
});
