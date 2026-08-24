import type { RequestHandler } from 'express';
import { allowedOrigins } from '../config/cors.js';
import { AppError } from '../errors/app-error.js';
import { AUTH_COOKIE_NAME } from '../modules/auth/token.service.js';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

export const requireTrustedCookieOrigin: RequestHandler = (req, _res, next) => {
  if (
    safeMethods.has(req.method) ||
    !req.cookies?.[AUTH_COOKIE_NAME] ||
    req.headers.authorization?.startsWith('Bearer ')
  )
    return next();
  const origin = req.get('origin');
  if (origin && allowedOrigins.includes(origin)) return next();
  next(new AppError(403, 'The request origin is not allowed.', 'ORIGIN_NOT_ALLOWED'));
};
