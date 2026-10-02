import { confirmAccountDeletionSchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { env } from '../../config/env.js';
import { AUTH_COOKIE_NAME } from '../auth/token.service.js';
import { AccountDeletionService } from './account-deletion.service.js';

const deletion = new AccountDeletionService();
const userId = (locals: Record<string, unknown>) => String(locals.authUserId);
const requestId = (locals: Record<string, unknown>) =>
  typeof locals.requestId === 'string' ? locals.requestId : undefined;

export const deletionPreview: RequestHandler = async (_req, res, next) => {
  try {
    res.json({ data: await deletion.preview(userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};

export const requestDeletion: RequestHandler = async (req, res, next) => {
  try {
    const data = await deletion.request(
      userId(res.locals),
      confirmAccountDeletionSchema.parse(req.body),
      requestId(res.locals),
    );
    res.clearCookie(AUTH_COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: env.NODE_ENV === 'production', path: '/' });
    res.status(202).json({ data });
  } catch (error) {
    next(error);
  }
};
