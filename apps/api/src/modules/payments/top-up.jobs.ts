import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import { enqueueDurableJob, registerDurableJobHandler } from '../../jobs/durable-jobs.js';
import { TOP_UP_EXPIRE_JOB_TYPE } from './top-up.service.js';
import { TopUpSettlementService } from './top-up-settlement.service.js';

const parsePayload = (payload: unknown) => {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  if (typeof record.providerPaymentId !== 'string')
    throw Object.assign(new Error('Invalid top-up expiry payload.'), { code: 'JOB_PAYLOAD_INVALID' });
  return { providerPaymentId: record.providerPaymentId, attempt: Number(record.attempt ?? 0) || 0 };
};

/**
 * TKT-604 / D11: if the webhook is missing or late, this job verifies the top-up with Paystack
 * and settles it through the same idempotent path. Open top-ups are re-checked every
 * TOP_UP_PENDING_EXPIRY_MINUTES until TOP_UP_MAX_PENDING_HOURS, then closed (or sent to review).
 */
export async function runTopUpExpiry(
  payload: unknown,
  settlement = new TopUpSettlementService(),
  now = new Date(),
) {
  const { providerPaymentId, attempt } = parsePayload(payload);
  const payment = await prisma.providerPayment.findUnique({ where: { id: providerPaymentId } });
  if (!payment || payment.status !== 'INITIALIZED') return;
  const result = await settlement.settleFromVerify(payment.reference, 'expiry_job', { now });
  if (result.status !== 'INITIALIZED') return;
  const next = attempt + 1;
  await prisma.$transaction((tx) =>
    enqueueDurableJob(tx, {
      type: TOP_UP_EXPIRE_JOB_TYPE,
      dedupeKey: `paystack-topup-expire:${payment.id}:${next}`,
      payload: { providerPaymentId: payment.id, attempt: next },
      runAt: new Date(now.getTime() + env.TOP_UP_PENDING_EXPIRY_MINUTES * 60_000),
    }),
  );
}

export const registerTopUpJobHandlers = (settlement = new TopUpSettlementService()) => {
  registerDurableJobHandler(TOP_UP_EXPIRE_JOB_TYPE, (payload) => runTopUpExpiry(payload, settlement));
};
