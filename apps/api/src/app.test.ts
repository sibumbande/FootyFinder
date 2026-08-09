import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { allowedOrigins } from './config/cors.js';
import { app } from './app.js';

describe('CORS policy', () => {
  it('allows the configured web origin with credentials', async () => {
    const response = await request(app).get('/health').set('Origin', allowedOrigins[0]);
    expect(response.headers['access-control-allow-origin']).toBe(allowedOrigins[0]);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not expose CORS headers to unknown browser origins', async () => {
    const response = await request(app).get('/health').set('Origin', 'https://malicious.example');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('handles preflight requests for the configured origin', async () => {
    const response = await request(app)
      .options('/users')
      .set('Origin', allowedOrigins[0])
      .set('Access-Control-Request-Method', 'GET');
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(allowedOrigins[0]);
  });
});

describe('protected endpoints', () => {
  it('rejects an unauthenticated current-user request', async () => {
    const response = await request(app).get('/users/me');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHENTICATED');
  });
});
