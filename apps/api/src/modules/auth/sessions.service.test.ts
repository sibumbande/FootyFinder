import { describe, expect, it, vi } from 'vitest';
import type { SessionsRepository } from './sessions.repository.js';
import type { TokenService } from './token.service.js';
import { SessionsService } from './sessions.service.js';

const repository = () => ({
  create: vi.fn(),
  findActive: vi.fn(),
  findLegacyUser: vi.fn(),
  touch: vi.fn(),
  revoke: vi.fn(),
  revokeAll: vi.fn(),
});

describe('SessionsService', () => {
  it('issues a signed token bound to a persisted session and hashes client metadata', async () => {
    const sessions = repository();
    sessions.create.mockResolvedValue({ id: 'session-1', userId: 'user-1' });
    const tokens = { sign: vi.fn().mockReturnValue('signed'), verify: vi.fn() };
    const result = await new SessionsService(
      sessions as unknown as SessionsRepository,
      tokens as unknown as TokenService,
    ).issue('user-1', { ip: '127.0.0.1', userAgent: 'test-browser' });

    expect(result).toMatchObject({ token: 'signed', sessionId: 'session-1' });
    expect(tokens.sign).toHaveBeenCalledWith('user-1', 'session-1');
    expect(sessions.create).toHaveBeenCalledWith(
      'user-1',
      expect.any(Date),
      expect.objectContaining({
        ipHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        userAgentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it('accepts only active, unexpired persisted sessions and returns account status', async () => {
    const sessions = repository();
    sessions.findActive.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      user: { accountStatus: 'SUSPENDED' },
    });
    const tokens = { verify: vi.fn().mockReturnValue({ sub: 'user-1', sid: 'session-1' }) };
    const result = await new SessionsService(
      sessions as unknown as SessionsRepository,
      tokens as unknown as TokenService,
    ).verify('token');

    expect(result).toEqual({
      userId: 'user-1',
      sessionId: 'session-1',
      accountStatus: 'SUSPENDED',
    });
    expect(sessions.touch).toHaveBeenCalledWith('session-1', expect.any(Date));
  });

  it('rejects a revoked or expired persisted session', async () => {
    const sessions = repository();
    sessions.findActive.mockResolvedValue(null);
    const tokens = { verify: vi.fn().mockReturnValue({ sub: 'user-1', sid: 'session-1' }) };
    await expect(
      new SessionsService(
        sessions as unknown as SessionsRepository,
        tokens as unknown as TokenService,
      ).verify('token'),
    ).rejects.toThrow('Session is revoked or expired');
  });

  it('revokes only the session carried by the supplied token', async () => {
    const sessions = repository();
    const tokens = { verify: vi.fn().mockReturnValue({ sub: 'user-1', sid: 'session-1' }) };
    await new SessionsService(
      sessions as unknown as SessionsRepository,
      tokens as unknown as TokenService,
    ).revokeToken('token');
    expect(sessions.revoke).toHaveBeenCalledWith('session-1', 'user-1', expect.any(Date));
    expect(sessions.revokeAll).not.toHaveBeenCalled();
  });
});
