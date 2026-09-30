import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ verifiedAt: null as Date | null, role: 'ADMIN', lastCutoff: null as Date | null }));
vi.mock('../database/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => ({ platformRole: db.role, accountStatus: 'ACTIVE' })) },
    authSession: {
      findFirst: vi.fn(async ({ where }: { where: { adminVerifiedAt: { gte: Date } } }) => {
        db.lastCutoff = where.adminVerifiedAt.gte;
        return db.verifiedAt && db.verifiedAt >= where.adminVerifiedAt.gte ? { id: 'session-1' } : null;
      }),
    },
  },
}));

const { requireAdminMfa, requirePlatformAdmin, requireRecentAdminMfa } = await import('./require-admin.js');
const { errorHandler } = await import('./error-handler.js');

const app = () =>
  express()
    .use((_req, res, next) => {
      res.locals.authUserId = 'admin-1';
      res.locals.authSessionId = 'session-1';
      next();
    })
    .post('/approve', requirePlatformAdmin, requireAdminMfa, requireRecentAdminMfa, (_req, res) => {
      res.json({ data: 'approved' });
    })
    .use(errorHandler);

beforeEach(() => {
  db.role = 'ADMIN';
  db.verifiedAt = null;
});

describe('settlement MFA freshness (TKT-608 / D9)', () => {
  it('allows an admin who verified with MFA in the last 15 minutes', async () => {
    db.verifiedAt = new Date(Date.now() - 5 * 60_000);
    expect((await request(app()).post('/approve')).status).toBe(200);
  });

  it('requires re-verification when the MFA session is older than 15 minutes', async () => {
    db.verifiedAt = new Date(Date.now() - 30 * 60_000);
    const response = await request(app()).post('/approve');
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('ADMIN_MFA_REVERIFY_REQUIRED');
    // Also used for referee and result actions (Gate 8 / D25), so the message names no settlement.
    expect(response.body.error).toBe('Verify with your authenticator again to continue with this action.');
    expect(Date.now() - db.lastCutoff!.getTime()).toBeLessThanOrEqual(15 * 60_000 + 1_000);
  });

  it('rejects non-admins and sessions without MFA', async () => {
    db.role = 'USER';
    db.verifiedAt = new Date();
    expect((await request(app()).post('/approve')).body.code).toBe('ADMIN_FORBIDDEN');
    db.role = 'ADMIN';
    db.verifiedAt = null;
    expect((await request(app()).post('/approve')).body.code).toBe('ADMIN_MFA_REQUIRED');
  });
});
