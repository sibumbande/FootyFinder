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

  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])(
    'handles %s preflight requests for the configured origin',
    async (method) => {
      const response = await request(app)
        .options('/wallet/deposits/demo')
        .set('Origin', allowedOrigins[0])
        .set('Access-Control-Request-Method', method)
        .set('Access-Control-Request-Headers', 'authorization,content-type,idempotency-key');
      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe(allowedOrigins[0]);
      expect(response.headers['access-control-allow-credentials']).toBe('true');
      expect(response.headers['access-control-allow-methods']).toContain(method);
      const allowedHeaders = response.headers['access-control-allow-headers'].toLowerCase();
      expect(allowedHeaders).toContain('authorization');
      expect(allowedHeaders).toContain('content-type');
      expect(allowedHeaders).toContain('idempotency-key');
    },
  );
});

describe('protected endpoints', () => {
  it('rejects an unauthenticated current-user request', async () => {
    const response = await request(app).get('/users/me');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHENTICATED');
  });

  it('keeps Team invite inspection public but requires auth for acceptance', async () => {
    const inspection = await request(app).get('/team-invites/not-a-real-token');
    expect(inspection.status).toBe(404);
    expect(inspection.body.code).toBe('TEAM_INVITE_INVALID');

    const acceptance = await request(app).post('/team-invites/not-a-real-token/accept');
    expect(acceptance.status).toBe(401);
    expect(acceptance.body.code).toBe('UNAUTHENTICATED');
  });
});

describe('route parameter validation', () => {
  it('rejects malformed public UUID parameters before querying persistence', async () => {
    const response = await request(app).get('/players/not-a-uuid');
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: 'INVALID_ROUTE_PARAMETER',
      details: { parameter: 'userId' },
    });
  });
});
