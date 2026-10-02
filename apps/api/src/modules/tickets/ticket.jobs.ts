import { prisma } from '../../database/prisma.js';
import { enqueueDurableJob, registerDurableJobHandler } from '../../jobs/durable-jobs.js';
import { expireTicketHold, TICKET_HOLD_EXPIRE_JOB_TYPE } from './ticket-checkout.service.js';
import { registerTicketEmailJobHandlers } from './ticket-emails.js';
import { registerTicketRefundJobHandlers } from './ticket-refunds.js';
import { TICKET_CHOICE_AUTO_REFUND_JOB_TYPE } from './ticket-cancellation.js';
import { TicketLeaveService } from './ticket-leave.service.js';
import { expireMatchCredits, MATCH_CREDIT_EXPIRE_JOB, nextCreditExpiryRunAt } from './match-credits.js';

const scheduleCreditExpiry = (now: Date) => {
  const runAt = nextCreditExpiryRunAt(now);
  return prisma.$transaction((tx) =>
    enqueueDurableJob(tx, { type: MATCH_CREDIT_EXPIRE_JOB, dedupeKey: `match-credit-expire:${runAt.toISOString().slice(0, 10)}`, payload: {}, runAt }),
  );
};
/** DEC-021 A4: the nightly credit expiry (02:30 Johannesburg); the server schedules one on start. */
export const scheduleMatchCreditExpiry = () => scheduleCreditExpiry(new Date());
import { TICKET_PAYMENT_MAX_PENDING_HOURS, TicketSettlementService } from './ticket-settlement.service.js';

export const TICKET_PAYMENT_RECHECK_JOB_TYPE = 'TICKET_PAYMENT_RECHECK';
const RECHECK_MINUTES = 60;

const checkoutIdOf = (payload: unknown) => {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  if (typeof record.checkoutId !== 'string')
    throw Object.assign(new Error('Invalid ticket hold payload.'), { code: 'JOB_PAYLOAD_INVALID' });
  return record.checkoutId;
};

/**
 * DEC-021 A1.2: 10 minutes after a checkout started, verify it once with Paystack (a payment that just went through
 * is placed), then release the place if it is still unpaid. A payment can still arrive later without its webhook,
 * so it is re-verified every hour for 24 hours (then closed); a late success is applied as a late payment.
 */
export async function runTicketHoldExpiry(checkoutId: string, settlement = new TicketSettlementService(), now = new Date()) {
  const checkout = await prisma.ticketCheckout.findUnique({ where: { id: checkoutId }, include: { providerPayment: true } });
  if (!checkout) return;
  const payment = checkout.providerPayment;
  if (payment?.status === 'INITIALIZED' && payment.authorizationUrl) await settlement.settleFromVerify(payment.reference, 'expiry_job', { now });
  await expireTicketHold(checkoutId, now);
  const after = payment ? await prisma.providerPayment.findUnique({ where: { id: payment.id } }) : null;
  if (after?.status === 'INITIALIZED' && after.authorizationUrl)
    await prisma.$transaction((tx) =>
      enqueueDurableJob(tx, {
        type: TICKET_PAYMENT_RECHECK_JOB_TYPE,
        dedupeKey: `ticket-payment-recheck:${after.id}:1`,
        payload: { providerPaymentId: after.id, attempt: 1 },
        runAt: new Date(now.getTime() + RECHECK_MINUTES * 60_000),
      }),
    );
}

export async function runTicketPaymentRecheck(payload: unknown, settlement = new TicketSettlementService(), now = new Date()) {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  if (typeof record.providerPaymentId !== 'string') throw Object.assign(new Error('Invalid recheck payload.'), { code: 'JOB_PAYLOAD_INVALID' });
  const attempt = Number(record.attempt ?? 1) || 1;
  const payment = await prisma.providerPayment.findUnique({ where: { id: record.providerPaymentId } });
  if (!payment || payment.status !== 'INITIALIZED') return;
  const finalAttempt = attempt * RECHECK_MINUTES >= TICKET_PAYMENT_MAX_PENDING_HOURS * 60;
  const result = await settlement.settleFromVerify(payment.reference, 'expiry_job', { now, finalAttempt });
  if (result.outcome !== 'WAIT' || finalAttempt) return;
  await prisma.$transaction((tx) =>
    enqueueDurableJob(tx, {
      type: TICKET_PAYMENT_RECHECK_JOB_TYPE,
      dedupeKey: `ticket-payment-recheck:${payment.id}:${attempt + 1}`,
      payload: { providerPaymentId: payment.id, attempt: attempt + 1 },
      runAt: new Date(now.getTime() + RECHECK_MINUTES * 60_000),
    }),
  );
}

/** DEC-021: hold expiry, late-payment rechecks, ticket refunds and ticket emails. */
export const registerTicketJobHandlers = () => {
  registerDurableJobHandler(TICKET_HOLD_EXPIRE_JOB_TYPE, (payload) => runTicketHoldExpiry(checkoutIdOf(payload)));
  registerDurableJobHandler(TICKET_PAYMENT_RECHECK_JOB_TYPE, (payload) => runTicketPaymentRecheck(payload));
  registerDurableJobHandler(TICKET_CHOICE_AUTO_REFUND_JOB_TYPE, async (payload) => {
    const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
    if (typeof record.ticketId !== 'string') throw Object.assign(new Error('Invalid choice payload.'), { code: 'JOB_PAYLOAD_INVALID' });
    await new TicketLeaveService().autoRefund(record.ticketId);
  });
  registerDurableJobHandler(MATCH_CREDIT_EXPIRE_JOB, async () => {
    await expireMatchCredits(prisma);
    await scheduleCreditExpiry(new Date(Date.now() + 60_000));
  });
  registerTicketRefundJobHandlers();
  registerTicketEmailJobHandlers();
};
