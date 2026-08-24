import { env } from '../../config/env.js';
import type { Prisma } from '@prisma/client';
import { serializableTransaction } from '../../database/transaction.js';
import { prisma } from '../../database/prisma.js';
import { AppError } from '../../errors/app-error.js';
import { appendAdminAudit } from './admin-audit.js';
import {
  adminOtpauthUri,
  createAdminMfaSecret,
  decryptAdminMfaSecret,
  encryptAdminMfaSecret,
  verifyAdminTotp,
} from './admin-mfa.js';

export class AdminAuthService {
  async status(userId: string, sessionId: string) {
    const [credential, session] = await Promise.all([
      prisma.adminMfaCredential.findUnique({ where: { userId } }),
      prisma.authSession.findUnique({ where: { id: sessionId } }),
    ]);
    const cutoff = Date.now() - env.ADMIN_MFA_MAX_AGE_MINUTES * 60_000;
    return {
      configured: Boolean(credential?.confirmedAt),
      verified: Boolean(session?.adminVerifiedAt && session.adminVerifiedAt.getTime() >= cutoff),
      verifiedAt: session?.adminVerifiedAt?.toISOString(),
    };
  }

  async setup(userId: string, sessionId: string, requestId?: string) {
    return serializableTransaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const existing = await tx.adminMfaCredential.findUnique({ where: { userId } });
      if (existing?.confirmedAt)
        throw new AppError(
          409,
          'Multi-factor authentication is already configured.',
          'MFA_CONFIGURED',
        );
      const secret = existing
        ? decryptAdminMfaSecret(existing.encryptedSecret)
        : createAdminMfaSecret();
      if (!existing)
        await tx.adminMfaCredential.create({
          data: { userId, encryptedSecret: encryptAdminMfaSecret(secret) },
        });
      await appendAdminAudit(tx, {
        actorUserId: userId,
        action: 'ADMIN_MFA_SETUP_STARTED',
        entityType: 'USER',
        entityId: userId,
        requestId,
      });
      return {
        ...(await this.statusFromTransaction(tx, userId, sessionId)),
        secret,
        otpauthUri: adminOtpauthUri(secret, user.email),
      };
    });
  }

  async verify(userId: string, sessionId: string, code: string, requestId?: string) {
    return serializableTransaction(async (tx) => {
      const credential = await tx.adminMfaCredential.findUnique({ where: { userId } });
      if (!credential)
        throw new AppError(409, 'Set up multi-factor authentication first.', 'MFA_NOT_CONFIGURED');
      if (!verifyAdminTotp(decryptAdminMfaSecret(credential.encryptedSecret), code))
        throw new AppError(401, 'The verification code is invalid.', 'MFA_CODE_INVALID');
      const verifiedAt = new Date();
      await tx.adminMfaCredential.update({
        where: { userId },
        data: { confirmedAt: credential.confirmedAt ?? verifiedAt },
      });
      await tx.authSession.update({
        where: { id: sessionId },
        data: { adminVerifiedAt: verifiedAt },
      });
      await appendAdminAudit(tx, {
        actorUserId: userId,
        action: credential.confirmedAt ? 'ADMIN_MFA_VERIFIED' : 'ADMIN_MFA_CONFIGURED',
        entityType: 'AUTH_SESSION',
        entityId: sessionId,
        requestId,
      });
      return { configured: true, verified: true, verifiedAt: verifiedAt.toISOString() };
    });
  }

  private async statusFromTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    sessionId: string,
  ) {
    const [credential, session] = await Promise.all([
      tx.adminMfaCredential.findUnique({ where: { userId } }),
      tx.authSession.findUnique({ where: { id: sessionId } }),
    ]);
    return {
      configured: Boolean(credential?.confirmedAt),
      verified: Boolean(session?.adminVerifiedAt),
      verifiedAt: session?.adminVerifiedAt?.toISOString(),
    };
  }
}
