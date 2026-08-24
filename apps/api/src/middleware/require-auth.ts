import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { requestAuthToken } from '../modules/auth/auth-credential.js';
import { SessionsService } from '../modules/auth/sessions.service.js';

const sessions = new SessionsService();

const authenticate =
  (activeOnly: boolean): RequestHandler =>
  async (req, res, next) => {
    const token = requestAuthToken(req);
    if (!token) return next(new AppError(401, 'Authentication required.', 'UNAUTHENTICATED'));
    try {
      const session = await sessions.verify(token);
      if (activeOnly && session.accountStatus !== 'ACTIVE')
        return next(
          new AppError(
            403,
            'This account is restricted. Contact support for assistance.',
            'ACCOUNT_RESTRICTED',
          ),
        );
      res.locals.authUserId = session.userId;
      res.locals.authSessionId = session.sessionId;
      res.locals.accountStatus = session.accountStatus;
      next();
    } catch {
      next(new AppError(401, 'Your session is invalid or has expired.', 'UNAUTHENTICATED'));
    }
  };

export const requireSession = authenticate(false);
export const requireAuth = authenticate(true);
