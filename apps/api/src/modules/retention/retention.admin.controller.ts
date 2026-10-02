import { setRetentionModeSchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { AppError } from '../../errors/app-error.js';
import { isRetentionCategory } from './retention.policy.js';
import { RetentionService } from './retention.service.js';

const service = new RetentionService();
const adminId = (locals: Record<string, unknown>) => String(locals.authUserId);

export const overview: RequestHandler = async (_req, res, next) => {
  try {
    res.json({ data: await service.overview() });
  } catch (error) {
    next(error);
  }
};

/** "Report now": always a dry run, whatever the category modes are. */
export const reportNow: RequestHandler = async (_req, res, next) => {
  try {
    await service.run({ trigger: 'ADMIN_REPORT', actorUserId: adminId(res.locals) });
    res.json({ data: await service.overview() });
  } catch (error) {
    next(error);
  }
};

export const setMode: RequestHandler = async (req, res, next) => {
  try {
    const category = String(req.params.category);
    if (!isRetentionCategory(category)) throw new AppError(404, 'Retention category not found.', 'RETENTION_CATEGORY_NOT_FOUND');
    const { mode } = setRetentionModeSchema.parse(req.body);
    res.json({ data: await service.setMode(category, mode, adminId(res.locals), String(res.locals.requestId ?? '')) });
  } catch (error) {
    next(error);
  }
};
