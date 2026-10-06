import { adminFinanceReasonSchema, adminPaymentQuerySchema, adminRefundBankDetailsSchema } from '@footy-finder/shared';
import type { Request, RequestHandler } from 'express';
import { AppError } from '../../errors/app-error.js';
import { AdminFinanceService } from './admin-finance.service.js';
import { CardRefundsService } from './card-refunds.service.js';
import { PaymentDisputesService } from './payment-disputes.service.js';
import { PaystackClient } from './paystack.client.js';

const finance = new AdminFinanceService();
const refunds = new CardRefundsService();
const disputes = new PaymentDisputesService();
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

export const listPayments = handle((req) => finance.payments(adminPaymentQuerySchema.parse(req.query)));

export const getPayment = handle(async (req) => {
  const payment = await finance.payment(String(req.params.paymentId));
  if (!payment) throw new AppError(404, 'Payment not found.', 'PAYMENT_NOT_FOUND');
  return payment;
});

/**
 * DEC-021 A7: refunds are made by the ticket rules (leaving, cancellation, late or double payment), never as a
 * free-form admin amount, and never back "to the wallet". Finance retries a failed refund, or retries a bank refund
 * with the customer's account (NEEDS_ATTENTION).
 */
export const retryRefund = handle(async (req, locals) => {
  const refund = await refunds.retry({ actorUserId: actor(locals), refundId: String(req.params.refundId), requestId: requestId(locals) });
  return finance.payment(refund.providerPaymentId);
});

/** CEO touch-up batch 4, item 3 (D8): fresh MFA (route); the account number goes to Paystack only. */
export const refundBankDetails = handle(async (req, locals) => {
  const input = adminRefundBankDetailsSchema.parse(req.body);
  const refund = await refunds.retryWithCustomerDetails({ actorUserId: actor(locals), refundId: String(req.params.refundId), ...input, requestId: requestId(locals) });
  return finance.payment(refund.providerPaymentId);
});

export const paystackBanks = handle(async () => {
  const client = new PaystackClient();
  return client.listBanks();
});

// CEO batch 5, item 6: the "Refunds needing attention" queue.
export const refundsNeedingAttention = handle(() => finance.refundsNeedingAttention());

// DEC-021 A8 / D9: payment disputes, their evidence packs, and lifting a payer's booking restriction (fresh MFA).
export const paymentDisputes = handle(() => disputes.list());
export const paymentDisputeEvidence = handle((req) => disputes.evidence(String(req.params.paymentDisputeId)));
export const liftBookingRestriction = handle(async (req, locals) => {
  const { reason } = adminFinanceReasonSchema.parse(req.body);
  return disputes.liftRestriction({
    actorUserId: actor(locals),
    userId: String(req.params.userId),
    reason,
    requestId: requestId(locals),
  });
});
