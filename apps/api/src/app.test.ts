import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { allowedOrigins } from './config/cors.js';
import { app } from './app.js';
import { redactedRequestPath } from './middleware/request-context.js';

describe('CORS policy', () => {
  it('allows the configured web origin with credentials', async () => {
    const response = await request(app).get('/health').set('Origin', allowedOrigins[0]);
    expect(response.headers['access-control-allow-origin']).toBe(allowedOrigins[0]);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('allows both the player and Admin browser origins', async () => {
    expect(allowedOrigins).toHaveLength(2);
    for (const origin of allowedOrigins) {
      const response = await request(app).get('/health').set('Origin', origin);
      expect(response.headers['access-control-allow-origin']).toBe(origin);
    }
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

describe('request hardening', () => {
  it('redacts secret invitation tokens from structured request paths', () => {
    expect(redactedRequestPath('/matches/invite/secret-token')).toBe('/matches/invite/[REDACTED]');
    expect(redactedRequestPath('/team-invites/team-secret/accept')).toBe(
      '/team-invites/[REDACTED]/accept',
    );
  });
  it('sets security and correlation headers without identifying Express', async () => {
    const response = await request(app).get('/health');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('rejects untrusted cookie-authenticated mutations before domain handling', async () => {
    const response = await request(app)
      .post('/auth/logout')
      .set('Origin', 'https://malicious.example')
      .set('Cookie', 'footy_finder_session=not-a-real-token');
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('allows bearer-authenticated server clients without an Origin header', async () => {
    const response = await request(app)
      .post('/auth/logout')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(response.status).toBe(200);
  });
});

describe('protected endpoints', () => {
  it('rejects an unauthenticated current-user request', async () => {
    const response = await request(app).get('/users/me');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHENTICATED');
  });

  it('keeps Admin authentication and privileged routes behind persisted auth', async () => {
    expect((await request(app).get('/admin/auth/status')).body.code).toBe('UNAUTHENTICATED');
    expect((await request(app).get('/admin/audit-logs')).body.code).toBe('UNAUTHENTICATED');
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
