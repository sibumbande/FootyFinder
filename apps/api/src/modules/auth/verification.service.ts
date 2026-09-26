import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { Prisma, VerificationPurpose, VerificationToken } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import { env } from '../../config/env.js';
import { AppError } from '../../errors/app-error.js';
import { emitDomainEventBestEffort } from '../../events/domain-events.js';
import { createEmailProvider, type EmailProvider } from './email.provider.js';
import { SessionsService } from './sessions.service.js';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const VERIFICATION_EXPIRY_MS = 24 * 60 * 60_000;
const RESET_EXPIRY_MS = 30 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;
const ROLLING_DAY_MS = 24 * 60 * 60_000;
const MAX_SENDS_PER_DAY = 5;
const MAX_TOKEN_ATTEMPTS = 5;

export class VerificationService {
  constructor(
    private readonly emails: EmailProvider = createEmailProvider(),
    private readonly sessions = new SessionsService(),
  ) {}

  async sendEmailVerification(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, emailVerifiedAt: true, accountStatus: true } });
    if (!user) throw new AppError(404, 'Account not found.', 'ACCOUNT_NOT_FOUND');
    if (user.accountStatus !== 'ACTIVE')
      throw new AppError(403, 'This account is restricted. Contact support for assistance.', 'ACCOUNT_RESTRICTED');
    if (user.emailVerifiedAt) return { sent: false, alreadyVerified: true };
    await this.issue(user.id, user.email, 'EMAIL_VERIFICATION');
    return { sent: true, alreadyVerified: false };
  }

  async verifyEmail(token: string) {
    await this.consume(token, 'EMAIL_VERIFICATION', (tx, record) =>
      tx.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      }),
    );
    return { success: true };
  }

  async requestPasswordReset(email: string) {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, accountStatus: true } });
    if (user?.accountStatus === 'ACTIVE') {
      try {
        await this.issue(user.id, user.email, 'PASSWORD_RESET');
      } catch {
        // Recovery is deliberately generic against account enumeration and delivery probing.
      }
    }
    return { success: true };
  }

  async resetPassword(token: string, password: string) {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const userId = await this.consume(token, 'PASSWORD_RESET', async (tx, record) => {
      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash, passwordChangedAt: new Date() },
      });
      return record.userId;
    });
    await this.sessions.revokeAll(userId);
    emitDomainEventBestEffort('auth:user-sessions-revoked', { userId });
    return { success: true };
  }

  async requestEmailChange(userId: string, newEmail: string, currentPassword: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, passwordHash: true, accountStatus: true } });
    if (user && user.accountStatus !== 'ACTIVE')
      throw new AppError(403, 'This account is restricted. Contact support for assistance.', 'ACCOUNT_RESTRICTED');
    if (!user || !(await argon2.verify(user.passwordHash, currentPassword)))
      throw new AppError(401, 'Current password is incorrect.', 'CURRENT_PASSWORD_INVALID');
    if (newEmail === user.email) throw new AppError(400, 'Choose a different email address.', 'EMAIL_UNCHANGED');
    if (await prisma.user.findUnique({ where: { email: newEmail }, select: { id: true } }))
      throw new AppError(409, 'That email address is already registered.', 'EMAIL_TAKEN');
    await this.issue(user.id, user.email, 'EMAIL_CHANGE', newEmail);
    return { success: true };
  }

  async confirmEmailChange(token: string) {
    const previousEmail = await this.consume(token, 'EMAIL_CHANGE', async (tx, record) => {
      if (!record.targetEmail)
        throw new AppError(400, 'This email-change link is invalid.', 'VERIFICATION_TOKEN_INVALID');
      if (await tx.user.findUnique({ where: { email: record.targetEmail }, select: { id: true } }))
        throw new AppError(409, 'That email address is already registered.', 'EMAIL_TAKEN');
      await tx.user.update({
        where: { id: record.userId },
        data: { email: record.targetEmail, emailVerifiedAt: new Date() },
      });
      return { email: record.email, targetEmail: record.targetEmail };
    });
    await this.emails.send({
      to: previousEmail.email,
      subject: 'Your Footy Finder email was changed',
      text: `Your Footy Finder sign-in email was changed to ${previousEmail.targetEmail}. Contact support immediately if this was not you.`,
    }).catch(() => undefined);
    return { success: true };
  }

  private async issue(userId: string, email: string, purpose: VerificationPurpose, targetEmail?: string) {
    const now = new Date();
    const recent = await prisma.verificationToken.findMany({
      where: { email, purpose, createdAt: { gte: new Date(now.getTime() - ROLLING_DAY_MS) } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (recent[0] && now.getTime() - recent[0].createdAt.getTime() < RESEND_COOLDOWN_MS)
      throw new AppError(429, 'Please wait before requesting another email.', 'VERIFICATION_COOLDOWN');
    if (recent.length >= MAX_SENDS_PER_DAY)
      throw new AppError(429, 'The daily email limit has been reached.', 'VERIFICATION_DAILY_LIMIT');

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + (purpose === 'PASSWORD_RESET' ? RESET_EXPIRY_MS : VERIFICATION_EXPIRY_MS));
    const record = await prisma.$transaction(async (tx) => {
      await tx.verificationToken.updateMany({
        where: { userId, purpose, usedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });
      return tx.verificationToken.create({
        data: { userId, purpose, tokenHash: hashToken(token), email, targetEmail, expiresAt },
      });
    });
    const link = this.linkFor(purpose, token);
    try {
      await this.emails.send({
        to: purpose === 'EMAIL_CHANGE' ? targetEmail! : email,
        subject: purpose === 'PASSWORD_RESET' ? 'Reset your Footy Finder password' : purpose === 'EMAIL_CHANGE' ? 'Confirm your new Footy Finder email' : 'Verify your Footy Finder email',
        text: `Open this single-use link: ${link}`,
      });
      await prisma.verificationToken.update({ where: { id: record.id }, data: { deliveryStatus: 'SENT', sentAt: new Date() } });
    } catch (error) {
      await prisma.verificationToken.update({
        where: { id: record.id },
        data: { deliveryStatus: 'FAILED', deliveryError: error instanceof Error ? error.message.slice(0, 500) : 'Delivery failed' },
      });
      throw new AppError(503, 'The email could not be sent. Please try again.', 'EMAIL_DELIVERY_FAILED');
    }
  }

  private linkFor(purpose: VerificationPurpose, token: string) {
    const path = purpose === 'PASSWORD_RESET' ? '/reset-password' : purpose === 'EMAIL_CHANGE' ? '/confirm-email-change' : '/verify-email';
    return `${env.CLIENT_URL.replace(/\/$/, '')}${path}?token=${encodeURIComponent(token)}`;
  }

  private async consume<T>(
    token: string,
    purpose: VerificationPurpose,
    action: (tx: Prisma.TransactionClient, record: VerificationToken) => Promise<T>,
  ) {
    const now = new Date();
    return prisma.$transaction(async (tx) => {
      const record = await tx.verificationToken.findUnique({ where: { tokenHash: hashToken(token) } });
      if (!record || record.purpose !== purpose)
        throw new AppError(400, 'This link is invalid or has expired.', 'VERIFICATION_TOKEN_INVALID');
      const claimed = await tx.verificationToken.updateMany({
        where: {
          id: record.id,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
          attemptCount: { lt: MAX_TOKEN_ATTEMPTS },
        },
        data: { usedAt: now, attemptCount: { increment: 1 } },
      });
      if (claimed.count !== 1)
        throw new AppError(400, 'This link is invalid or has expired.', 'VERIFICATION_TOKEN_INVALID');
      return action(tx, record);
    });
  }
}
