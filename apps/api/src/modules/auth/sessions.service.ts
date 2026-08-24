import { createHash } from 'node:crypto';
import { env } from '../../config/env.js';
import { TokenService } from './token.service.js';
import { SessionsRepository } from './sessions.repository.js';

const privacyHash = (value: string | undefined) =>
  value ? createHash('sha256').update(value).digest('hex') : undefined;

export interface SessionClientMetadata {
  ip?: string;
  userAgent?: string;
}

export interface VerifiedSession {
  userId: string;
  sessionId?: string;
  accountStatus: 'ACTIVE' | 'SUSPENDED' | 'BANNED';
}

export class SessionsService {
  constructor(
    private readonly sessions = new SessionsRepository(),
    private readonly tokens = new TokenService(),
  ) {}

  async issue(userId: string, metadata: SessionClientMetadata) {
    const expiresAt = new Date(Date.now() + env.JWT_EXPIRES_IN_SECONDS * 1000);
    const session = await this.sessions.create(userId, expiresAt, {
      ipHash: privacyHash(metadata.ip),
      userAgentHash: privacyHash(metadata.userAgent),
    });
    return {
      token: this.tokens.sign(userId, session.id),
      sessionId: session.id,
      expiresAt,
    };
  }

  async verify(token: string): Promise<VerifiedSession> {
    const payload = this.tokens.verify(token);
    const now = new Date();
    if (payload.sid) {
      const session = await this.sessions.findActive(payload.sid, payload.sub, now);
      if (!session) throw new Error('Session is revoked or expired');
      await this.sessions.touch(session.id, now);
      return {
        userId: session.userId,
        sessionId: session.id,
        accountStatus: session.user.accountStatus,
      };
    }

    const graceUntil = env.LEGACY_JWT_GRACE_UNTIL;
    if (!graceUntil || now >= graceUntil) throw new Error('Legacy session has expired');
    const user = await this.sessions.findLegacyUser(payload.sub);
    if (!user) throw new Error('User no longer exists');
    return { userId: user.id, accountStatus: user.accountStatus };
  }

  async revokeToken(token: string | undefined) {
    if (!token) return;
    try {
      const payload = this.tokens.verify(token);
      if (payload.sid) await this.sessions.revoke(payload.sid, payload.sub, new Date());
    } catch {
      // Logout remains idempotent for invalid or expired credentials.
    }
  }

  revokeAll(userId: string) {
    return this.sessions.revokeAll(userId, new Date());
  }
}
