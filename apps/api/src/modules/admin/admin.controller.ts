import { adminMfaCodeSchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { AppError } from '../../errors/app-error.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminService } from './admin.service.js';

const auth = new AdminAuthService();
const admin = new AdminService();
const identity = (locals: Record<string, unknown>) => {
  if (typeof locals.authSessionId !== 'string')
    throw new AppError(401, 'A persisted session is required.', 'UNAUTHENTICATED');
  return { userId: String(locals.authUserId), sessionId: locals.authSessionId };
};

export const status: RequestHandler = async (_req, res, next) => {
  try {
    const { userId, sessionId } = identity(res.locals);
    res.json({ data: await auth.status(userId, sessionId) });
  } catch (error) {
    next(error);
  }
};
export const setupMfa: RequestHandler = async (_req, res, next) => {
  try {
    const { userId, sessionId } = identity(res.locals);
    res.json({ data: await auth.setup(userId, sessionId, String(res.locals.requestId)) });
  } catch (error) {
    next(error);
  }
};
export const verifyMfa: RequestHandler = async (req, res, next) => {
  try {
    const { userId, sessionId } = identity(res.locals);
    const { code } = adminMfaCodeSchema.parse(req.body);
    res.json({ data: await auth.verify(userId, sessionId, code, String(res.locals.requestId)) });
  } catch (error) {
    next(error);
  }
};
export const auditLog: RequestHandler = async (_req, res, next) => {
  try {
    res.json({ data: await admin.auditLog() });
  } catch (error) {
    next(error);
  }
};
