import type { Notification, Prisma, ProviderRefund } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { logError } from '../../observability/logger.js';
import { incrementOperationalMetric } from '../../observability/operational-metrics.js';
import { appendAdminAudit } from '../admin/admin-audit.js';
import { notificationDedupeKey, persistNotifications } from '../notifications/notification-writer.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PaystackClient, PaystackError, type PaystackGateway } from './paystack.client.js';

const rands = (cents: number) => `R${(cents / 100).toFixed(2)}`;
const lockRefund = (tx: Prisma.TransactionClient, id: string) =>
  tx.$queryRaw`SELECT "id" FROM "ProviderRefund" WHERE "id" = ${id}::uuid FOR UPDATE`;

/**
 * TKT-606 / DEC-021 A7: refunds to the original payment method through the Paystack Refund API (partial refunds by
 * `amount`). Ticket refunds are created by the ticket rules (ticket-refunds.ts) and submitted here.
 * - A failed refund stays FAILED for finance, which retries it. A bank refund Paystack cannot send without the
 *   customer's account is NEEDS_ATTENTION and is retried with their bank details. A failed refund never silently
 *   becomes a match credit.
 */
export class CardRefundsService {
  constructor(
    private readonly gateway: PaystackGateway = new PaystackClient(),
    private readonly notifications = new NotificationsService(),
  ) {}

  /**
   * DEC-021: submits a ticket refund queued in another transaction (TICKET_REFUND_SUBMIT). Only a refund still PENDING
   * with no Paystack id is sent, so a replayed job never refunds twice.
   */
  async submitQueued(refundId: string) {
    const refund = await prisma.providerRefund.findUnique({ where: { id: refundId } });
    if (!refund || refund.status !== 'PENDING' || refund.providerRefundId) return refund;
    return this.submit(refundId);
  }

  /** Sends one refund to Paystack. Any provider error leaves it FAILED for finance review. */
  private async submit(refundId: string) {
    const refund = await prisma.providerRefund.findUniqueOrThrow({ where: { id: refundId }, include: { providerPayment: true } });
    // DEC-021: a development/test demo payment (never possible in production) is refunded by the demo operator.
    if (refund.providerPayment.provider === 'demo')
      return prisma.providerRefund.update({
        where: { id: refund.id },
        data: { providerRefundId: `demo-${refund.id}`, attempts: { increment: 1 }, status: 'PROCESSED', processedAt: new Date(), failureReason: null },
      });
    try {
      const result = await this.gateway.refund({
        reference: refund.providerPayment.reference,
        amountCents: refund.amountCents,
        merchantNote: 'FootyFinder match ticket refund',
      });
      return prisma.providerRefund.update({
        where: { id: refund.id },
        data: {
          providerRefundId: result.id || undefined,
          attempts: { increment: 1 },
          failureReason: null,
          ...(result.status === 'processed'
            ? { status: 'PROCESSED', processedAt: new Date() }
            : result.status === 'processing'
              ? { status: 'PROCESSING' }
              : {}),
        },
      }).then(async (updated) => (result.status === 'needs-attention' ? this.markNeedsAttention(updated.id, ['PENDING']) : updated));
    } catch (error) {
      logError('card_refund_submit_failed', error, { refundId });
      incrementOperationalMetric('card_refund_failed_total');
      return this.markFailed(refund.id, error instanceof PaystackError ? error.code : 'submit_error', ['PENDING'], true);
    }
  }

  private async markFailed(refundId: string, reason: string, from: ProviderRefund['status'][], countAttempt = false) {
    const { refund, notifications } = await serializableTransaction(async (tx) => {
      await lockRefund(tx, refundId);
      const current = await tx.providerRefund.findUniqueOrThrow({ where: { id: refundId }, include: { providerPayment: true, ticket: { select: { matchId: true } } } });
      if (!from.includes(current.status)) return { refund: current, notifications: [] as Notification[] };
      const updated = await tx.providerRefund.update({
        where: { id: refundId },
        data: { status: 'FAILED', failureReason: reason.slice(0, 80), ...(countAttempt && { attempts: { increment: 1 } }) },
      });
      return {
        refund: updated,
        notifications: await persistNotifications(tx, [
          {
            userId: current.providerPayment.userId,
            type: current.ticket ? 'TICKET_REFUND_UPDATE' : 'INFO',
            title: 'Refund delayed',
            message: `Your ${rands(current.amountCents)} refund to the card or account you paid with could not be completed yet. Our finance team will follow up with you.`,
            targetPath: current.ticket ? `/matches/${current.ticket.matchId}` : '/tickets',
            dedupeKey: notificationDedupeKey('provider-refund', refundId, `failed-${current.attempts}`, current.providerPayment.userId),
          },
        ]),
      };
    });
    this.notifications.publishPersistedMany(notifications);
    return refund;
  }

  /**
   * CEO touch-up batch 4, item 3 (D8): Paystack could not complete a bank-payment refund (Instant EFT, Capitec Pay)
   * because it did not receive the customer's bank account. Support asks the player for it; finance then retries with
   * the details.
   */
  private async markNeedsAttention(refundId: string, from: ProviderRefund['status'][]) {
    const { refund, notifications } = await serializableTransaction(async (tx) => {
      await lockRefund(tx, refundId);
      const current = await tx.providerRefund.findUniqueOrThrow({ where: { id: refundId }, include: { providerPayment: true, ticket: { select: { id: true } } } });
      if (!from.includes(current.status)) return { refund: current, notifications: [] as Notification[] };
      const updated = await tx.providerRefund.update({ where: { id: refundId }, data: { status: 'NEEDS_ATTENTION', failureReason: 'needs_customer_bank_account' } });
      return {
        refund: updated,
        notifications: await persistNotifications(tx, [
          {
            userId: current.providerPayment.userId,
            type: current.ticket ? 'TICKET_REFUND_UPDATE' : 'INFO',
            title: 'Refund needs your bank details',
            message: `To send your ${rands(current.amountCents)} refund back to your bank account, our support team needs your account details. We will contact you.`,
            targetPath: '/support',
            dedupeKey: notificationDedupeKey('provider-refund', refundId, 'needs-attention', current.providerPayment.userId),
          },
        ]),
      };
    });
    this.notifications.publishPersistedMany(notifications);
    return refund;
  }

  /**
   * CEO touch-up batch 4, item 3 (D8): finance sends the customer's bank account for a NEEDS_ATTENTION refund. The
   * account number goes to Paystack only; the audit log keeps the bank name and the last 4 digits.
   */
  async retryWithCustomerDetails(input: { actorUserId: string; refundId: string; accountNumber: string; bankId: string; bankName: string; requestId?: string }) {
    const current = await prisma.providerRefund.findUnique({ where: { id: input.refundId } });
    if (!current) throw new AppError(404, 'Refund not found.', 'REFUND_NOT_FOUND');
    if (current.status !== 'NEEDS_ATTENTION' || !current.providerRefundId)
      throw new AppError(409, 'Only a refund waiting for bank details can be sent this way.', 'REFUND_NOT_NEEDING_ATTENTION');
    if (!this.gateway.retryRefundWithAccount) throw new AppError(503, 'Bank-detail refunds are not available.', 'REFUND_RETRY_UNAVAILABLE');
    try {
      await this.gateway.retryRefundWithAccount(current.providerRefundId, { accountNumber: input.accountNumber, bankId: input.bankId });
    } catch (error) {
      logError('refund_retry_with_details_failed', error, { refundId: current.id });
      throw new AppError(502, error instanceof PaystackError ? error.message : 'Paystack could not take the bank details. Check them and try again.', 'REFUND_RETRY_REJECTED');
    }
    return serializableTransaction(async (tx) => {
      await lockRefund(tx, current.id);
      const updated = await tx.providerRefund.update({ where: { id: current.id }, data: { status: 'PROCESSING', failureReason: null, attempts: { increment: 1 } } });
      await appendAdminAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'TOP_UP_REFUND_BANK_DETAILS_SENT',
        entityType: 'ProviderRefund',
        entityId: current.id,
        requestId: input.requestId,
        metadata: { bankName: input.bankName, accountLast4: input.accountNumber.slice(-4) },
      });
      return updated;
    });
  }

  /**
   * D3: finance retries a FAILED refund. Before retrying a refund that failed with
   * PAYSTACK_UNAVAILABLE, finance must confirm in the Paystack dashboard that it was not already
   * processed (a timeout does not prove the refund was not created).
   */
  async retry(input: { actorUserId: string; refundId: string; requestId?: string }) {
    await serializableTransaction(async (tx) => {
      await lockRefund(tx, input.refundId);
      const current = await tx.providerRefund.findUnique({ where: { id: input.refundId } });
      if (!current) throw new AppError(404, 'Refund not found.', 'REFUND_NOT_FOUND');
      if (current.status !== 'FAILED' || current.reviewReason)
        throw new AppError(409, 'Only a failed refund can be retried.', 'REFUND_NOT_RETRYABLE');
      await tx.providerRefund.update({ where: { id: current.id }, data: { status: 'PENDING', failureReason: null } });
      await appendAdminAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'TOP_UP_REFUND_RETRIED',
        entityType: 'ProviderRefund',
        entityId: current.id,
        requestId: input.requestId,
        metadata: { previousFailure: current.failureReason, attempts: current.attempts },
      });
    });
    return this.submit(input.refundId);
  }

  /** refund.pending / refund.processing / refund.processed / refund.failed webhooks. */
  async applyWebhook(eventType: string, reference: string | null, data: Record<string, unknown>) {
    if (!reference) return 'refund_missing_reference';
    const payment = await prisma.providerPayment.findUnique({ where: { reference }, include: { refunds: { orderBy: { createdAt: 'asc' } } } });
    if (!payment) return 'refund_unknown_reference';
    const providerRefundId = data.id === undefined ? undefined : String(data.id);
    const amount = Number(data.amount);
    // Match by Paystack's refund id. Without it, fall back to the amount only when exactly one refund of that amount
    // is still open: a team payment can carry several equal R80 refunds (DEC-021 A5), and guessing between them
    // could mark the wrong ticket's refund. A later event carries the id (saved when we submitted the refund).
    const byId = providerRefundId ? payment.refunds.find((item) => item.providerRefundId === providerRefundId) : undefined;
    const open = payment.refunds.filter((item) => item.amountCents === amount && ['PENDING', 'PROCESSING', 'FAILED'].includes(item.status) && (!item.providerRefundId || !providerRefundId));
    const settled = payment.refunds.filter((item) => item.amountCents === amount);
    const match = byId ?? (open.length === 1 ? open[0] : open.length === 0 && settled.length === 1 ? settled[0] : undefined);
    if (!match) return open.length > 1 || settled.length > 1 ? 'refund_ambiguous' : 'refund_unmatched';
    // CEO touch-up batch 4, item 3 (D8): a bank refund waiting for the customer's account, whichever event says so.
    if (data.status === 'needs-attention') {
      const updated = await this.markNeedsAttention(match.id, ['PENDING', 'PROCESSING']);
      return updated.status === 'NEEDS_ATTENTION' ? 'refund_needs_attention' : 'refund_replayed';
    }
    if (eventType === 'refund.failed') {
      if (match.status === 'PROCESSED') {
        await prisma.providerRefund.update({ where: { id: match.id }, data: { reviewReason: 'failed_after_processed' } });
        return 'refund_review';
      }
      const updated = await this.markFailed(match.id, 'provider_failed', ['PENDING', 'PROCESSING']);
      return updated.status === 'FAILED' ? 'refund_failed' : 'refund_replayed';
    }
    return serializableTransaction(async (tx) => {
      await lockRefund(tx, match.id);
      const current = await tx.providerRefund.findUniqueOrThrow({ where: { id: match.id } });
      const idUpdate = providerRefundId && !current.providerRefundId ? { providerRefundId } : {};
      if (eventType === 'refund.processed') {
        if (current.status === 'PROCESSED') return 'refund_replayed';
        if (current.status === 'RESTORED_TO_WALLET') {
          // An earlier payment record (before DEC-021): the card was refunded after the money was restored; finance reviews it.
          await tx.providerRefund.update({ where: { id: current.id }, data: { ...idUpdate, reviewReason: 'processed_after_restore' } });
          return 'refund_review';
        }
        await tx.providerRefund.update({
          where: { id: current.id },
          data: { ...idUpdate, status: 'PROCESSED', processedAt: new Date(), failureReason: null },
        });
        return 'refund_processed';
      }
      if (current.status === 'PENDING' && eventType === 'refund.processing') {
        await tx.providerRefund.update({ where: { id: current.id }, data: { ...idUpdate, status: 'PROCESSING' } });
        return 'refund_processing';
      }
      if (Object.keys(idUpdate).length) await tx.providerRefund.update({ where: { id: current.id }, data: idUpdate });
      return 'refund_noted';
    });
  }
}
