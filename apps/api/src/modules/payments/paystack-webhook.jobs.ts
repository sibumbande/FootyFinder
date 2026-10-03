import { prisma } from '../../database/prisma.js';
import { registerDurableJobHandler } from '../../jobs/durable-jobs.js';
import { PAYSTACK_WEBHOOK_JOB_TYPE } from './paystack-webhook.js';
import { CardRefundsService } from './card-refunds.service.js';
import { PaymentDisputesService } from './payment-disputes.service.js';
import { TopUpSettlementService } from './top-up-settlement.service.js';
import { TicketSettlementService } from '../tickets/ticket-settlement.service.js';

export type WebhookEventHandler = (event: {
  id: string;
  eventType: string;
  reference: string | null;
  data: Record<string, unknown>;
}) => Promise<string>;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/**
 * Processes one stored, authenticated webhook event. The event body is treated only as a hint:
 * a charge.success makes our server verify the reference with Paystack itself (settleFromVerify).
 */
export class PaystackWebhookProcessor {
  private readonly handlers = new Map<string, WebhookEventHandler>();

  constructor(
    settlement = new TopUpSettlementService(),
    refunds = new CardRefundsService(),
    disputes = new PaymentDisputesService(),
    tickets = new TicketSettlementService(),
  ) {
    this.on('charge.success', async ({ reference }) => {
      if (!reference) return 'missing_reference';
      const known = await prisma.providerPayment.findUnique({ where: { reference }, select: { id: true, purpose: true } });
      if (!known) return 'unknown_reference';
      // DEC-021: a match ticket payment is applied by the ticket settlement path (verify, then place or refund).
      if (known.purpose === 'TICKETS') return `ticket_${(await tickets.settleFromVerify(reference, 'webhook')).outcome.toLowerCase()}`;
      const result = await settlement.settleFromVerify(reference, 'webhook');
      return `charge_${result.outcome.toLowerCase()}`;
    });
    // TKT-606: refunds to card. DEC-021 D9: payment disputes (chargebacks) restrict bookings; nothing is reversed.
    for (const type of ['refund.pending', 'refund.processing', 'refund.processed', 'refund.failed'])
      this.on(type, ({ eventType, reference, data }) => refunds.applyWebhook(eventType, reference, data));
    this.on('charge.dispute.create', ({ reference, data }) => disputes.open(reference, data));
    this.on('charge.dispute.remind', async () => 'dispute_reminder_noted');
    this.on('charge.dispute.resolve', ({ data }) => disputes.resolve(data));
  }

  on(eventType: string, handler: WebhookEventHandler) {
    this.handlers.set(eventType, handler);
    return this;
  }

  async process(webhookEventId: string) {
    const event = await prisma.paymentWebhookEvent.findUnique({ where: { id: webhookEventId } });
    if (!event || !event.signatureValid || event.processedAt) return;
    const handler = this.handlers.get(event.eventType ?? '');
    const outcome = handler
      ? await handler({
          id: event.id,
          eventType: event.eventType ?? '',
          reference: event.reference,
          data: record(record(event.payload).data),
        })
      : 'ignored_event_type';
    await prisma.paymentWebhookEvent.updateMany({
      where: { id: event.id, processedAt: null },
      data: { processedAt: new Date(), outcome: outcome.slice(0, 80) },
    });
  }
}

export const registerPaystackWebhookJobHandlers = (processor = new PaystackWebhookProcessor()) => {
  registerDurableJobHandler(PAYSTACK_WEBHOOK_JOB_TYPE, async (payload) => {
    const id = record(payload).webhookEventId;
    if (typeof id !== 'string')
      throw Object.assign(new Error('Invalid webhook job payload.'), { code: 'JOB_PAYLOAD_INVALID' });
    await processor.process(id);
  });
  return processor;
};
