import type { RequestHandler } from 'express';
import { prisma } from '../database/prisma.js';
import { AppError } from '../errors/app-error.js';
import { env } from '../config/env.js';

export const requirePlatformAdmin: RequestHandler = async (_req, res, next) => {
  try {
    const userId = String(res.locals.authUserId);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { platformRole: true, accountStatus: true },
    });
    if (!user || user.platformRole !== 'ADMIN' || user.accountStatus !== 'ACTIVE')
      return next(new AppError(403, 'Administrator access is required.', 'ADMIN_FORBIDDEN'));
    next();
  } catch (error) {
    next(error);
  }
};

export const requireAdminMfa: RequestHandler = async (_req, res, next) => {
  try {
    const sessionId = res.locals.authSessionId;
    if (typeof sessionId !== 'string')
      return next(new AppError(403, 'A verified Admin session is required.', 'ADMIN_MFA_REQUIRED'));
    const cutoff = new Date(Date.now() - env.ADMIN_MFA_MAX_AGE_MINUTES * 60_000);
    const session = await prisma.authSession.findFirst({
      where: { id: sessionId, adminVerifiedAt: { gte: cutoff }, revokedAt: null },
      select: { id: true },
    });
    if (!session)
      return next(
        new AppError(403, 'Complete Admin verification to continue.', 'ADMIN_MFA_REQUIRED'),
      );
    next();
  } catch (error) {
    next(error);
  }
};
