import { ACCOUNT_DELETION_STATUSES, settleAccountClosureSchema, type AccountDeletionStatus } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { AccountDeletionAdminService } from './account-deletion.admin.service.js';

const service = new AccountDeletionAdminService();
const isStatus = (value: unknown): value is AccountDeletionStatus =>
  typeof value === 'string' && (ACCOUNT_DELETION_STATUSES as readonly string[]).includes(value);

/** CEO batch 5, item 6: deletion requests (read-only). */
export const list: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.list(isStatus(req.query.status) ? req.query.status : undefined) });
  } catch (error) {
    next(error);
  }
};

/** Finance records that a deleted account's money has been settled (fresh MFA, audited). */
export const settle: RequestHandler = async (req, res, next) => {
  try {
    const { note } = settleAccountClosureSchema.parse(req.body);
    res.json({ data: await service.settle(String(req.params.requestId), String(res.locals.authUserId), note, String(res.locals.requestId ?? '')) });
  } catch (error) {
    next(error);
  }
};
