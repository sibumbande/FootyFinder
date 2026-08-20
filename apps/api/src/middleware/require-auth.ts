import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { AUTH_COOKIE_NAME, TokenService } from '../modules/auth/token.service.js';

const tokens = new TokenService();

export const requireAuth: RequestHandler = (req, res, next) => {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : undefined;
  const token = bearer ?? req.cookies?.[AUTH_COOKIE_NAME];
  if (!token) return next(new AppError(401, 'Authentication required.', 'UNAUTHENTICATED'));
  try {
    res.locals.authUserId = tokens.verify(token).sub;
    next();
  } catch {
    next(new AppError(401, 'Your session is invalid or has expired.', 'UNAUTHENTICATED'));
  }
};
