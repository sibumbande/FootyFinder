import { prisma } from '../../database/prisma.js';

export interface SessionMetadata {
  userAgentHash?: string;
  ipHash?: string;
}

export class SessionsRepository {
  create(userId: string, expiresAt: Date, metadata: SessionMetadata) {
    return prisma.authSession.create({
      data: { userId, expiresAt, ...metadata },
      select: { id: true, userId: true, expiresAt: true },
    });
  }

  findActive(id: string, userId: string, now: Date) {
    return prisma.authSession.findFirst({
      where: { id, userId, revokedAt: null, expiresAt: { gt: now } },
      select: {
        id: true,
        userId: true,
        lastSeenAt: true,
        user: {
          select: {
            accountStatus: true,
            emailVerifiedAt: true,
            emailVerificationRequired: true,
            onboardingCompletedAt: true,
          },
        },
      },
    });
  }

  findLegacyUser(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        accountStatus: true,
        emailVerifiedAt: true,
        emailVerificationRequired: true,
        onboardingCompletedAt: true,
      },
    });
  }

  touch(id: string, seenAt: Date) {
    return prisma.authSession.updateMany({
      where: { id, revokedAt: null, lastSeenAt: { lt: new Date(seenAt.getTime() - 5 * 60_000) } },
      data: { lastSeenAt: seenAt },
    });
  }

  revoke(id: string, userId: string, revokedAt: Date) {
    return prisma.authSession.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt },
    });
  }

  revokeAll(userId: string, revokedAt: Date) {
    return prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt },
    });
  }
}
