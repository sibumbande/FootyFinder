import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const transactionClient = {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    verificationToken: {
      updateMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
    },
  };
  return {
    transactionClient,
    prisma: {
      user: { findUnique: vi.fn(), update: vi.fn() },
      verificationToken: { findMany: vi.fn(), update: vi.fn() },
      $transaction: vi.fn(async (callback: (tx: typeof transactionClient) => unknown) => callback(transactionClient)),
    },
  };
});
vi.mock('../../database/prisma.js', () => ({ prisma: mocks.prisma }));

import type { SessionsService } from './sessions.service.js';
import { TestEmailProvider } from './email.provider.js';
import { VerificationService } from './verification.service.js';

const userId = '4a5529e6-4289-4f0a-94b7-233950def34d';

describe('VerificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.user.findUnique.mockResolvedValue({ id: userId, email: 'player@example.test', emailVerifiedAt: null, accountStatus: 'ACTIVE' });
    mocks.prisma.verificationToken.findMany.mockResolvedValue([]);
    mocks.transactionClient.verificationToken.updateMany.mockResolvedValue({ count: 1 });
    mocks.transactionClient.verificationToken.create.mockResolvedValue({ id: 'token-record' });
    mocks.prisma.verificationToken.update.mockResolvedValue({});
    mocks.prisma.user.update.mockResolvedValue({});
    mocks.transactionClient.user.findUnique.mockResolvedValue(null);
    mocks.transactionClient.user.update.mockResolvedValue({});
  });

  it('stores only a SHA-256 token hash and sends a 24-hour single-use link', async () => {
    const emails = new TestEmailProvider();
    const service = new VerificationService(emails, { revokeAll: vi.fn() } as unknown as SessionsService);
    await service.sendEmailVerification(userId);

    const created = mocks.transactionClient.verificationToken.create.mock.calls[0][0].data;
    const rawToken = new URL(emails.messages[0]!.text.split(' ').at(-1)!).searchParams.get('token')!;
    expect(created.tokenHash).toBe(createHash('sha256').update(rawToken).digest('hex'));
    expect(created.tokenHash).not.toContain(rawToken);
    expect(created.expiresAt.getTime() - Date.now()).toBeGreaterThan(23 * 60 * 60_000);
    expect(mocks.prisma.verificationToken.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ deliveryStatus: 'SENT' }) }));
  });

  it('consumes a matching token once and rejects a replay', async () => {
    const emails = new TestEmailProvider();
    const service = new VerificationService(emails, { revokeAll: vi.fn() } as unknown as SessionsService);
    await service.sendEmailVerification(userId);
    const rawToken = new URL(emails.messages[0]!.text.split(' ').at(-1)!).searchParams.get('token')!;
    mocks.transactionClient.verificationToken.findUnique.mockResolvedValue({
      id: 'token-record', userId, purpose: 'EMAIL_VERIFICATION', email: 'player@example.test', targetEmail: null,
    });
    mocks.transactionClient.verificationToken.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(service.verifyEmail(rawToken)).resolves.toEqual({ success: true });
    mocks.transactionClient.verificationToken.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.verifyEmail(rawToken)).rejects.toMatchObject({ code: 'VERIFICATION_TOKEN_INVALID' });
  });

  it('enforces the resend cooldown without exposing another token', async () => {
    mocks.prisma.verificationToken.findMany.mockResolvedValue([{ createdAt: new Date() }]);
    const emails = new TestEmailProvider();
    const service = new VerificationService(emails, { revokeAll: vi.fn() } as unknown as SessionsService);
    await expect(service.sendEmailVerification(userId)).rejects.toMatchObject({ code: 'VERIFICATION_COOLDOWN' });
    expect(emails.messages).toHaveLength(0);
  });

  it('enforces the rolling daily limit and refuses delivery to a restricted account', async () => {
    const oldEnough = new Date(Date.now() - 2 * 60_000);
    mocks.prisma.verificationToken.findMany.mockResolvedValue(Array.from({ length: 5 }, () => ({ createdAt: oldEnough })));
    const emails = new TestEmailProvider();
    const service = new VerificationService(emails, { revokeAll: vi.fn() } as unknown as SessionsService);
    await expect(service.sendEmailVerification(userId)).rejects.toMatchObject({ code: 'VERIFICATION_DAILY_LIMIT' });
    mocks.prisma.user.findUnique.mockResolvedValue({ id: userId, email: 'player@example.test', emailVerifiedAt: null, accountStatus: 'SUSPENDED' });
    await expect(service.sendEmailVerification(userId)).rejects.toMatchObject({ code: 'ACCOUNT_RESTRICTED' });
    expect(emails.messages).toHaveLength(0);
  });

  it('records provider failure without exposing the raw link in persistence', async () => {
    const emails = { send: vi.fn().mockRejectedValue(new Error('provider unavailable')) };
    const service = new VerificationService(emails, { revokeAll: vi.fn() } as unknown as SessionsService);
    await expect(service.sendEmailVerification(userId)).rejects.toMatchObject({ code: 'EMAIL_DELIVERY_FAILED' });
    expect(mocks.prisma.verificationToken.update).toHaveBeenLastCalledWith({
      where: { id: 'token-record' },
      data: { deliveryStatus: 'FAILED', deliveryError: 'provider unavailable' },
    });
  });

  it('resets a password once and revokes every active session', async () => {
    const sessions = { revokeAll: vi.fn().mockResolvedValue({ count: 2 }) };
    const service = new VerificationService(new TestEmailProvider(), sessions as unknown as SessionsService);
    mocks.transactionClient.verificationToken.findUnique.mockResolvedValue({
      id: 'reset-record', userId, purpose: 'PASSWORD_RESET', email: 'player@example.test', targetEmail: null,
    });
    mocks.transactionClient.verificationToken.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.resetPassword('A'.repeat(43), 'new-football9')).resolves.toEqual({ success: true });
    expect(mocks.transactionClient.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: { passwordHash: expect.stringMatching(/^\$argon2/), passwordChangedAt: expect.any(Date) },
    });
    expect(sessions.revokeAll).toHaveBeenCalledWith(userId);
  });

  it('checks target uniqueness and swaps a verified email inside token consumption', async () => {
    const emails = new TestEmailProvider();
    const service = new VerificationService(emails, { revokeAll: vi.fn() } as unknown as SessionsService);
    mocks.transactionClient.verificationToken.findUnique.mockResolvedValue({
      id: 'change-record', userId, purpose: 'EMAIL_CHANGE', email: 'old@example.test', targetEmail: 'new@example.test',
    });
    await expect(service.confirmEmailChange('B'.repeat(43))).resolves.toEqual({ success: true });
    expect(mocks.transactionClient.user.findUnique).toHaveBeenCalledWith({ where: { email: 'new@example.test' }, select: { id: true } });
    expect(mocks.transactionClient.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: { email: 'new@example.test', emailVerifiedAt: expect.any(Date) },
    });
    expect(emails.messages[0]).toMatchObject({ to: 'old@example.test' });
  });
});
