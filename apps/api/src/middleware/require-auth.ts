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
      if (activeOnly && session.emailVerificationRequired && !session.emailVerified)
        return next(
          new AppError(403, 'Verify your email to continue.', 'EMAIL_VERIFICATION_REQUIRED'),
        );
      if (activeOnly && session.emailVerificationRequired && !session.onboardingComplete)
        return next(
          new AppError(403, 'Complete your player profile to continue.', 'ONBOARDING_REQUIRED'),
        );
      res.locals.authUserId = session.userId;
      res.locals.authSessionId = session.sessionId;
      res.locals.accountStatus = session.accountStatus;
      res.locals.emailVerified = session.emailVerified;
      res.locals.onboardingComplete = session.onboardingComplete;
      next();
    } catch {
      next(new AppError(401, 'Your session is invalid or has expired.', 'UNAUTHENTICATED'));
    }
  };

export const requireSession = authenticate(false);
export const requireAuth = authenticate(true);

export const optionalSession: RequestHandler = async (req, res, next) => {
  const token = requestAuthToken(req);
  if (!token) return next();
  try {
    const session = await sessions.verify(token);
    res.locals.authUserId = session.userId;
    res.locals.authSessionId = session.sessionId;
    res.locals.accountStatus = session.accountStatus;
    res.locals.emailVerified = session.emailVerified;
    res.locals.onboardingComplete = session.onboardingComplete;
    next();
  } catch {
    next(new AppError(401, 'Your session is invalid or has expired.', 'UNAUTHENTICATED'));
  }
};
