import type { Request, RequestHandler, Response } from 'express';
import { loginSchema, registerSchema } from './auth.schema.js';
import { AuthService } from './auth.service.js';
import { env } from '../../config/env.js';
import { requestAuthToken } from './auth-credential.js';
import { SessionsService } from './sessions.service.js';
import { AUTH_COOKIE_NAME } from './token.service.js';
import { emitDomainEventBestEffort } from '../../events/domain-events.js';
const service = new AuthService();
const sessions = new SessionsService();
const metadata = (req: Request) => ({ ip: req.ip, userAgent: req.get('user-agent') });
const setSession = (res: Response, token: string) =>
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    maxAge: env.JWT_EXPIRES_IN_SECONDS * 1000,
    path: '/',
  });
export const register: RequestHandler = async (req, res, next) => {
  try {
    const user = await service.register(registerSchema.parse(req.body));
    const session = await sessions.issue(user.id, metadata(req));
    setSession(res, session.token);
    res.status(201).json({ data: user });
  } catch (error) {
    next(error);
  }
};
export const login: RequestHandler = async (req, res, next) => {
  try {
    const user = await service.login(loginSchema.parse(req.body));
    const session = await sessions.issue(user.id, metadata(req));
    setSession(res, session.token);
    res.json({ data: user });
  } catch (error) {
    next(error);
  }
};
export const logout: RequestHandler = async (req, res, next) => {
  try {
    let tokenSessionId: string | undefined;
    const token = requestAuthToken(req);
    if (token) {
      try {
        tokenSessionId = (await sessions.verify(token)).sessionId;
      } catch {
        // Invalid sessions are still cleared idempotently.
      }
    }
    await sessions.revokeToken(requestAuthToken(req));
    if (tokenSessionId)
      emitDomainEventBestEffort('auth:session-revoked', { sessionId: tokenSessionId });
    res.clearCookie(AUTH_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      path: '/',
    });
    res.json({ data: { success: true } });
  } catch (error) {
    next(error);
  }
};
