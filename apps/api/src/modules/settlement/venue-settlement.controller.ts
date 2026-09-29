import {
  adminPayableQuerySchema,
  createVenueBeneficiarySchema,
  venuePayableAdjustmentSchema,
} from '@footy-finder/shared';
import type { Request, RequestHandler } from 'express';
import { VenueSettlementService } from './venue-settlement.service.js';

const settlement = new VenueSettlementService();
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

export const listBeneficiaries = handle((req) => settlement.beneficiaries(String(req.params.venueId)));

export const createBeneficiary = handle(
  (req, locals) =>
    settlement.createBeneficiary(actor(locals), String(req.params.venueId), createVenueBeneficiarySchema.parse(req.body), requestId(locals)),
  201,
);

export const approveBeneficiary = handle((req, locals) =>
  settlement.approveBeneficiary(actor(locals), String(req.params.beneficiaryId), requestId(locals)),
);

/** POST (not GET) and no-store: full bank details must never be cached or prefetched. */
export const revealBeneficiary: RequestHandler = async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: await settlement.revealBeneficiary(actor(res.locals), String(req.params.beneficiaryId), requestId(res.locals)) });
  } catch (error) {
    next(error);
  }
};

export const listPayables = handle((req) => settlement.payables(adminPayableQuerySchema.parse(req.query)));

export const adjustPayable = handle((req, locals) =>
  settlement.addAdjustment(actor(locals), String(req.params.payableId), venuePayableAdjustmentSchema.parse(req.body), requestId(locals)),
);
