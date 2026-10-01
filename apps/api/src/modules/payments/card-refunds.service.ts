import { randomUUID } from 'node:crypto';
import type { Notification, Prisma, ProviderRefund } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { logError } from '../../observability/logger.js';
import { incrementOperationalMetric } from '../../observability/operational-metrics.js';
import { appendAdminAudit } from '../admin/admin-audit.js';
import { notificationDedupeKey, persistNotifications } from '../notifications/notification-writer.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { FinancialInsufficientFundsError, FinancialRepository } from '../wallet/financial.repository.js';
import { PaystackClient, PaystackError, type PaystackGateway } from './paystack.client.js';

const rands = (cents: number) => `R${(cents / 100).toFixed(2)}`;
const lockRefund = (tx: Prisma.TransactionClient, id: string) =>
  tx.$queryRaw`SELECT "id" FROM "ProviderRefund" WHERE "id" = ${id}::uuid FOR UPDATE`;
type PaymentWithRefunds = Prisma.ProviderPaymentGetPayload<{ include: { refunds: true; disputes: true } }>;
const lockPayment = (tx: Prisma.TransactionClient, id: string) =>
  tx.$queryRaw`SELECT "id" FROM "ProviderPayment" WHERE "id" = ${id}::uuid FOR UPDATE`;

/**
 * TKT-606 / DEC-011 / D3 / D7: refunds of card top-ups back to the original card.
 * - Only an MFA-verified admin starts one. The wallet is debited at initiation so the money
 *   cannot also be spent, then Paystack is asked to refund the card.
 * - A failed refund stays FAILED for finance. It is never silently re-credited: an admin either
 *   retries it or explicitly restores it to the wallet with a written reason (audited).
 */
export class CardRefundsService {
  constructor(
    private readonly gateway: PaystackGateway = new PaystackClient(),
    private readonly financial = new FinancialRepository(),
    private readonly notifications = new NotificationsService(),
  ) {}

  async initiate(input: {
    actorUserId: string;
    providerPaymentId: string;
    amountCents: number;
    reason: string;
    idempotencyKey: string;
    requestId?: string;
    /** CEO touch-up batch 3, item 6b: a player's own undo (no admin audit; its own checks run under the lock). */
    source?: 'ADMIN' | 'PLAYER_UNDO';
    assertAllowed?: (tx: Prisma.TransactionClient, payment: PaymentWithRefunds) => Promise<void>;
  }) {
    const source = input.source ?? 'ADMIN';
    if (!input.idempotencyKey || input.idempotencyKey.length > 200)
      throw new AppError(400, 'A valid Idempotency-Key header is required.', 'IDEMPOTENCY_KEY_REQUIRED');
    const ledgerKey = `top-up-refund:${input.providerPaymentId}:${input.idempotencyKey}`;
    const { refund, created, notifications } = await serializableTransaction(async (tx) => {
      await lockPayment(tx, input.providerPaymentId);
      const payment = await tx.providerPayment.findUnique({
        where: { id: input.providerPaymentId },
        include: { refunds: true, disputes: true },
      });
      if (!payment) throw new AppError(404, 'Top-up not found.', 'TOP_UP_NOT_FOUND');
      const replay = await tx.walletTransaction.findUnique({ where: { idempotencyKey: ledgerKey }, include: { refundDebit: true } });
      if (replay?.refundDebit) {
        if (replay.refundDebit.amountCents !== input.amountCents)
          throw new AppError(409, 'That idempotency key was used for a different refund.', 'IDEMPOTENCY_KEY_REUSED');
        return { refund: replay.refundDebit, created: false, notifications: [] as Notification[] };
      }
      if (payment.status !== 'SUCCEEDED')
        throw new AppError(409, 'Only a credited top-up can be refunded to the card.', 'TOP_UP_NOT_REFUNDABLE');
      if (payment.disputes.length)
        throw new AppError(409, 'This top-up has a card dispute; refunds are handled through the dispute.', 'REFUND_BLOCKED_BY_DISPUTE');
      if (input.assertAllowed) await input.assertAllowed(tx, payment);
      const committed = payment.refunds
        .filter((item) => item.status !== 'RESTORED_TO_WALLET')
        .reduce((sum, item) => sum + item.amountCents, 0);
      if (!Number.isInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > payment.amountCents - committed)
        throw new AppError(400, `The refund must be between R0.01 and ${rands(payment.amountCents - committed)}.`, 'REFUND_AMOUNT_INVALID');
      const refundId = randomUUID();
      let debit;
      try {
        debit = await this.financial.debit(tx, {
          userId: payment.userId,
          amountCents: input.amountCents,
          type: 'TOP_UP_REFUND_DEBIT',
          idempotencyKey: ledgerKey,
          referenceType: 'PROVIDER_REFUND',
          referenceId: refundId,
          description: 'Refund to card',
        });
      } catch (error) {
        if (error instanceof FinancialInsufficientFundsError)
          throw new AppError(409, source === 'PLAYER_UNDO' ? 'You no longer have that much unspent credit from this top-up.' : 'The player no longer has that much unspent wallet credit.', 'REFUND_EXCEEDS_AVAILABLE');
        throw error;
      }
      const row = await tx.providerRefund.create({
        data: {
          id: refundId,
          providerPaymentId: payment.id,
          amountCents: input.amountCents,
          debitTransactionId: debit.transaction.id,
          reason: input.reason,
          source,
          initiatedByUserId: input.actorUserId,
        },
      });
      if (source === 'ADMIN') await appendAdminAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'TOP_UP_REFUND_INITIATED',
        entityType: 'ProviderRefund',
        entityId: row.id,
        requestId: input.requestId,
        metadata: { providerPaymentId: payment.id, amountCents: input.amountCents, reason: input.reason },
      });
      return {
        refund: row,
        created: true,
        notifications: await persistNotifications(tx, [
          {
            userId: payment.userId,
            type: 'WALLET_DEBIT',
            title: source === 'PLAYER_UNDO' ? 'Top-up undone' : 'Refund to your card',
            message: source === 'PLAYER_UNDO'
              ? `${rands(input.amountCents)} of your top-up is being refunded to the card you paid with.`
              : `${rands(input.amountCents)} is being refunded from your wallet to the card you paid with.`,
            targetPath: '/wallet',
            dedupeKey: notificationDedupeKey('provider-refund', row.id, 'initiated', payment.userId),
          },
        ]),
      };
    });
    this.notifications.publishPersistedMany(notifications);
    return created ? this.submit(refund.id) : refund;
  }

  /** Sends one refund to Paystack. Any provider error leaves it FAILED for finance review. */
  private async submit(refundId: string) {
    const refund = await prisma.providerRefund.findUniqueOrThrow({ where: { id: refundId }, include: { providerPayment: true } });
    try {
      const result = await this.gateway.refund({
        reference: refund.providerPayment.reference,
        amountCents: refund.amountCents,
        merchantNote: 'FootyFinder wallet top-up refund',
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
      });
    } catch (error) {
      logError('card_refund_submit_failed', error, { refundId });
      incrementOperationalMetric('card_refund_failed_total');
      return this.markFailed(refund.id, error instanceof PaystackError ? error.code : 'submit_error', ['PENDING'], true);
    }
  }

  private async markFailed(refundId: string, reason: string, from: ProviderRefund['status'][], countAttempt = false) {
    const { refund, notifications } = await serializableTransaction(async (tx) => {
      await lockRefund(tx, refundId);
      const current = await tx.providerRefund.findUniqueOrThrow({ where: { id: refundId }, include: { providerPayment: true } });
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
            type: 'INFO',
            title: 'Card refund delayed',
            message: `Your ${rands(current.amountCents)} refund to your card could not be completed yet. Our finance team will follow up with you.`,
            targetPath: '/wallet',
            dedupeKey: notificationDedupeKey('provider-refund', refundId, `failed-${current.attempts}`, current.providerPayment.userId),
          },
        ]),
      };
    });
    this.notifications.publishPersistedMany(notifications);
    return refund;
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

  /** D3: finance explicitly returns a FAILED refund's money to the wallet, with a written reason. */
  async restoreToWallet(input: { actorUserId: string; refundId: string; reason: string; requestId?: string }) {
    const { refund, notifications } = await serializableTransaction(async (tx) => {
      await lockRefund(tx, input.refundId);
      const current = await tx.providerRefund.findUnique({ where: { id: input.refundId }, include: { providerPayment: true } });
      if (!current) throw new AppError(404, 'Refund not found.', 'REFUND_NOT_FOUND');
      if (current.status === 'RESTORED_TO_WALLET') return { refund: current, notifications: [] as Notification[] };
      if (current.status !== 'FAILED')
        throw new AppError(409, 'Only a failed refund can be restored to the wallet.', 'REFUND_NOT_RESTORABLE');
      const credit = await this.financial.credit(tx, {
        userId: current.providerPayment.userId,
        amountCents: current.amountCents,
        type: 'TOP_UP_REFUND_RESTORE_CREDIT',
        idempotencyKey: `top-up-refund-restore:${current.id}`,
        referenceType: 'PROVIDER_REFUND',
        referenceId: current.id,
        description: 'Failed card refund returned to wallet',
      });
      const updated = await tx.providerRefund.update({
        where: { id: current.id },
        data: {
          status: 'RESTORED_TO_WALLET',
          restoreTransactionId: credit.transaction.id,
          restoredByUserId: input.actorUserId,
          restoreReason: input.reason,
        },
      });
      await appendAdminAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'TOP_UP_REFUND_RESTORED_TO_WALLET',
        entityType: 'ProviderRefund',
        entityId: current.id,
        requestId: input.requestId,
        metadata: { amountCents: current.amountCents, reason: input.reason },
      });
      return {
        refund: updated,
        notifications: await persistNotifications(tx, [
          {
            userId: current.providerPayment.userId,
            type: 'WALLET_CREDIT',
            title: 'Refund returned to your wallet',
            message: `Your ${rands(current.amountCents)} card refund could not be completed, so it was returned to your wallet.`,
            targetPath: '/wallet',
            dedupeKey: notificationDedupeKey('provider-refund', current.id, 'restored', current.providerPayment.userId),
          },
        ]),
      };
    });
    this.notifications.publishPersistedMany(notifications);
    return refund;
  }

  /** refund.pending / refund.processing / refund.processed / refund.failed webhooks. */
  async applyWebhook(eventType: string, reference: string | null, data: Record<string, unknown>) {
    if (!reference) return 'refund_missing_reference';
    const payment = await prisma.providerPayment.findUnique({ where: { reference }, include: { refunds: { orderBy: { createdAt: 'asc' } } } });
    if (!payment) return 'refund_unknown_reference';
    const providerRefundId = data.id === undefined ? undefined : String(data.id);
    const amount = Number(data.amount);
    const match =
      payment.refunds.find((item) => providerRefundId && item.providerRefundId === providerRefundId) ??
      payment.refunds.find((item) => item.amountCents === amount && ['PENDING', 'PROCESSING', 'FAILED'].includes(item.status)) ??
      payment.refunds.find((item) => item.amountCents === amount);
    if (!match) return 'refund_unmatched';
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
          // The card was refunded after finance restored the money to the wallet: finance must recover it.
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
