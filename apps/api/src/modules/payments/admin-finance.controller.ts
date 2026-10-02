import {
  adminCardRefundSchema,
  adminFinanceReasonSchema,
  adminRefundBankDetailsSchema,
  adminTopUpQuerySchema,
} from '@footy-finder/shared';
import type { Request, RequestHandler } from 'express';
import { AppError } from '../../errors/app-error.js';
import { AdminFinanceService } from './admin-finance.service.js';
import { CardRefundsService } from './card-refunds.service.js';
import { ChargebacksService } from './chargebacks.service.js';
import { PaystackClient } from './paystack.client.js';

const finance = new AdminFinanceService();
const refunds = new CardRefundsService();
const chargebacks = new ChargebacksService();
const actor = (locals: Record<string, unknown>) => String(locals.authUserId);
const requestId = (locals: Record<string, unknown>) => String(locals.requestId);

const handle =
  (work: (req: Request, locals: Record<string, unknown>) => Promise<unknown>): RequestHandler =>
  async (req, res, next) => {
    try {
      res.json({ data: await work(req, res.locals) });
    } catch (error) {
      next(error);
    }
  };

export const listTopUps = handle((req) => finance.topUps(adminTopUpQuerySchema.parse(req.query)));

export const getTopUp = handle(async (req) => {
  const topUp = await finance.topUp(String(req.params.paymentId));
  if (!topUp) throw new AppError(404, 'Top-up not found.', 'TOP_UP_NOT_FOUND');
  return topUp;
});

export const refundTopUp = handle(async (req, locals) => {
  const input = adminCardRefundSchema.parse(req.body);
  await refunds.initiate({
    actorUserId: actor(locals),
    providerPaymentId: String(req.params.paymentId),
    amountCents: input.amountCents,
    reason: input.reason,
    idempotencyKey: String(req.header('Idempotency-Key') ?? ''),
    requestId: requestId(locals),
  });
  return finance.topUp(String(req.params.paymentId));
});

export const retryRefund = handle(async (req, locals) => {
  const refund = await refunds.retry({ actorUserId: actor(locals), refundId: String(req.params.refundId), requestId: requestId(locals) });
  return finance.topUp(refund.providerPaymentId);
});

/** CEO touch-up batch 4, item 3 (D8): fresh MFA (route); the account number goes to Paystack only. */
export const refundBankDetails = handle(async (req, locals) => {
  const input = adminRefundBankDetailsSchema.parse(req.body);
  const refund = await refunds.retryWithCustomerDetails({ actorUserId: actor(locals), refundId: String(req.params.refundId), ...input, requestId: requestId(locals) });
  return finance.topUp(refund.providerPaymentId);
});

export const paystackBanks = handle(async () => {
  const client = new PaystackClient();
  return client.listBanks();
});

export const restoreRefund = handle(async (req, locals) => {
  const { reason } = adminFinanceReasonSchema.parse(req.body);
  const refund = await refunds.restoreToWallet({
    actorUserId: actor(locals),
    refundId: String(req.params.refundId),
    reason,
    requestId: requestId(locals),
  });
  return finance.topUp(refund.providerPaymentId);
});

export const restrictedWallets = handle(() => finance.restrictedWallets());

export const liftRestriction = handle(async (req, locals) => {
  const { reason } = adminFinanceReasonSchema.parse(req.body);
  return chargebacks.liftRestriction({
    actorUserId: actor(locals),
    userId: String(req.params.userId),
    reason,
    requestId: requestId(locals),
  });
});
