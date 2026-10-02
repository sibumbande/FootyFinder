import type { Prisma, RefundSource } from '../../generated/prisma/client.js';
import { enqueueDurableJob, registerDurableJobHandler } from '../../jobs/durable-jobs.js';
import { CardRefundsService } from '../payments/card-refunds.service.js';

export const TICKET_REFUND_SUBMIT_JOB_TYPE = 'TICKET_REFUND_SUBMIT';

/**
 * DEC-021 A7: queues a refund of one ticket (or of a credit that came from it, D11) to the original payment method,
 * in the transaction that decided it. The amount is the ticket's own price (a partial refund of a payment that
 * covered several players). The refund always goes to whoever paid. Once per ticket (and once per credit), enforced
 * by the database; a replay returns the existing refund.
 */
export async function requestTicketRefundInTx(
  tx: Prisma.TransactionClient,
  input: { ticketId: string; source: RefundSource; reason: string; initiatedByUserId: string; creditId?: string },
) {
  const existing = await tx.providerRefund.findFirst({ where: input.creditId ? { creditId: input.creditId } : { ticketId: input.ticketId, creditId: null } });
  if (existing) return existing;
  const ticket = await tx.matchTicket.findUniqueOrThrow({ where: { id: input.ticketId }, include: { checkout: { select: { providerPaymentId: true } } } });
  if (ticket.method !== 'PAYMENT' || !ticket.checkout.providerPaymentId || ticket.amountCents <= 0)
    throw new Error(`Ticket ${ticket.id} was not paid with money, so it cannot be refunded.`);
  const refund = await tx.providerRefund.create({
    data: {
      providerPaymentId: ticket.checkout.providerPaymentId,
      ticketId: ticket.id,
      creditId: input.creditId,
      amountCents: ticket.amountCents,
      reason: input.reason.slice(0, 500),
      source: input.source,
      initiatedByUserId: input.initiatedByUserId,
    },
  });
  await enqueueDurableJob(tx, {
    type: TICKET_REFUND_SUBMIT_JOB_TYPE,
    dedupeKey: `ticket-refund-submit:${refund.id}`,
    payload: { refundId: refund.id },
    runAt: new Date(),
  });
  return refund;
}

/** Sends a queued ticket refund to Paystack through the shared refund path (FAILED / NEEDS_ATTENTION for finance). */
export const registerTicketRefundJobHandlers = (refunds = new CardRefundsService()) => {
  registerDurableJobHandler(TICKET_REFUND_SUBMIT_JOB_TYPE, async (payload) => {
    const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
    if (typeof record.refundId !== 'string') throw Object.assign(new Error('Invalid refund payload.'), { code: 'JOB_PAYLOAD_INVALID' });
    await refunds.submitQueued(record.refundId);
  });
};
