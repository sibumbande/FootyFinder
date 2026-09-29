import {
  adminFinanceReasonSchema,
  adminSettlementQuerySchema,
  markSettlementPaidSchema,
  prepareSettlementSchema,
} from '@footy-finder/shared';
import type { Request, RequestHandler } from 'express';
import { SettlementBatchesService } from './settlement-batches.service.js';

const batches = new SettlementBatchesService();
const actor = (locals: Record<string, unknown>) => String(locals.authUserId);
const requestId = (locals: Record<string, unknown>) => String(locals.requestId);

const handle =
  (work: (req: Request, locals: Record<string, unknown>) => Promise<unknown>, status = 200): RequestHandler =>
  async (req, res, next) => {
    try {
      res.status(status).json({ data: await work(req, res.locals) });
    } catch (error) {
      next(error);
    }
  };

export const due = handle(() => batches.due());
export const list = handle((req) => batches.list(adminSettlementQuerySchema.parse(req.query).status));
export const get = handle((req) => batches.get(String(req.params.batchId)));
export const prepare = handle(
  (req, locals) => batches.prepare(actor(locals), prepareSettlementSchema.parse(req.body), requestId(locals)),
  201,
);
export const approve = handle((req, locals) => batches.approve(actor(locals), String(req.params.batchId), requestId(locals)));
export const markPaid = handle((req, locals) =>
  batches.markPaid(actor(locals), String(req.params.batchId), markSettlementPaidSchema.parse(req.body), requestId(locals)),
);
export const cancel = handle((req, locals) =>
  batches.cancel(actor(locals), String(req.params.batchId), adminFinanceReasonSchema.parse(req.body).reason, requestId(locals)),
);
