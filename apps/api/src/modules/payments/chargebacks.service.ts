import type { Notification } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { incrementOperationalMetric } from '../../observability/operational-metrics.js';
import { appendAdminAudit } from '../admin/admin-audit.js';
import { notificationDedupeKey, persistNotifications } from '../notifications/notification-writer.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { FinancialRepository } from '../wallet/financial.repository.js';

const rands = (cents: number) => `R${(cents / 100).toFixed(2)}`;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/**
 * Maps Paystack's dispute resolution to our outcome. "declined" means the merchant declined the
 * chargeback and kept the money (we won); an "accepted" resolution means the cardholder won.
 */
export const disputeOutcome = (resolution: unknown): 'WON' | 'LOST' | null => {
  const value = String(resolution ?? '').toLowerCase();
  if (value.includes('declined')) return 'WON';
  if (value.includes('accepted')) return 'LOST';
  return null;
};

/**
 * TKT-606 / DEC-011 / CEO D2, D5, D6: card chargebacks against top-ups.
 * - charge.dispute.create reverses the disputed top-up (CHARGEBACK_DEBIT), even below zero, and
 *   restricts spending in the same update.
 * - charge.dispute.resolve in our favour restores the credit (CHARGEBACK_REVERSAL_CREDIT); a lost
 *   dispute stays reversed. The restriction lifts once the wallet is repaid and nothing is open.
 */
export class ChargebacksService {
  constructor(
    private readonly financial = new FinancialRepository(),
    private readonly notifications = new NotificationsService(),
  ) {}

  async open(reference: string | null, data: Record<string, unknown>) {
    const disputeId = data.id === undefined ? '' : String(data.id);
    if (!reference || !disputeId) return 'dispute_missing_identifiers';
    const payment = await prisma.providerPayment.findUnique({ where: { reference }, include: { refunds: true } });
    if (!payment) return 'dispute_unknown_reference';
    if (payment.status !== 'SUCCEEDED') return 'dispute_on_uncredited_top_up';
    const refunded = payment.refunds
      .filter((refund) => refund.status !== 'RESTORED_TO_WALLET')
      .reduce((sum, refund) => sum + refund.amountCents, 0);
    const requested = Number(data.refund_amount ?? record(data.transaction).amount ?? payment.amountCents);
    const amountCents = Math.min(Number.isFinite(requested) && requested > 0 ? requested : payment.amountCents, payment.amountCents - refunded);
    if (amountCents <= 0) return 'dispute_after_full_refund';

    const result = await serializableTransaction(async (tx) => {
      const existing = await tx.providerDispute.findUnique({ where: { providerDisputeId: disputeId } });
      if (existing) return { outcome: 'dispute_replayed', notifications: [] as Notification[] };
      const debit = await this.financial.chargebackDebit(tx, {
        userId: payment.userId,
        amountCents,
        idempotencyKey: `chargeback:${disputeId}`,
        referenceType: 'PROVIDER_DISPUTE',
        referenceId: payment.id,
        description: 'Card payment disputed – top-up reversed',
        restrictionReason: 'CARD_CHARGEBACK',
      });
      await tx.providerDispute.create({
        data: { providerPaymentId: payment.id, providerDisputeId: disputeId, amountCents, debitTransactionId: debit.transaction.id },
      });
      return {
        outcome: 'dispute_opened',
        notifications: await persistNotifications(tx, [
          {
            userId: payment.userId,
            type: 'WALLET_DEBIT',
            title: 'Card payment disputed',
            message: `Your bank disputed a ${rands(amountCents)} top-up, so it was reversed from your wallet. Spending is paused until this is resolved.`,
            targetPath: '/wallet',
            dedupeKey: notificationDedupeKey('provider-dispute', disputeId, 'opened', payment.userId),
          },
        ]),
      };
    });
    this.notifications.publishPersistedMany(result.notifications);
    if (result.outcome === 'dispute_opened') incrementOperationalMetric('card_chargeback_opened_total');
    return result.outcome;
  }

  async resolve(data: Record<string, unknown>) {
    const disputeId = data.id === undefined ? '' : String(data.id);
    const dispute = disputeId
      ? await prisma.providerDispute.findUnique({ where: { providerDisputeId: disputeId }, include: { providerPayment: true } })
      : null;
    if (!dispute) return 'dispute_unknown';
    const outcome = disputeOutcome(data.resolution);
    if (!outcome) return 'dispute_resolution_unknown';
    const result = await serializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ProviderDispute" WHERE "id" = ${dispute.id}::uuid FOR UPDATE`;
      const current = await tx.providerDispute.findUniqueOrThrow({ where: { id: dispute.id } });
      if (current.status !== 'OPEN') return { outcome: 'dispute_replayed', notifications: [] as Notification[] };
      const userId = dispute.providerPayment.userId;
      let reversalTransactionId: string | undefined;
      if (outcome === 'WON') {
        const credit = await this.financial.credit(tx, {
          userId,
          amountCents: current.amountCents,
          type: 'CHARGEBACK_REVERSAL_CREDIT',
          idempotencyKey: `chargeback-reversal:${current.providerDisputeId}`,
          referenceType: 'PROVIDER_DISPUTE',
          referenceId: current.providerPaymentId,
          description: 'Card dispute resolved – top-up restored',
        });
        reversalTransactionId = credit.transaction.id;
      }
      await tx.providerDispute.update({
        where: { id: current.id },
        data: {
          status: outcome,
          resolvedAt: new Date(),
          resolution: String(data.resolution).slice(0, 80),
          reversalTransactionId,
        },
      });
      await this.financial.refreshRestriction(tx, userId);
      return {
        outcome: outcome === 'WON' ? 'dispute_won' : 'dispute_lost',
        notifications: await persistNotifications(tx, [
          {
            userId,
            type: outcome === 'WON' ? 'WALLET_CREDIT' : 'INFO',
            title: 'Card dispute resolved',
            message:
              outcome === 'WON'
                ? `The card dispute was resolved and ${rands(current.amountCents)} was restored to your wallet.`
                : `The card dispute was resolved in the cardholder's favour; the ${rands(current.amountCents)} reversal stands.`,
            targetPath: '/wallet',
            dedupeKey: notificationDedupeKey('provider-dispute', current.providerDisputeId, 'resolved', userId),
          },
        ]),
      };
    });
    this.notifications.publishPersistedMany(result.notifications);
    return result.outcome;
  }

  /** D6: an admin lifts a restriction on a wallet that is not below zero (audited, with reason). */
  async liftRestriction(input: { actorUserId: string; userId: string; reason: string; requestId?: string }) {
    return serializableTransaction(async (tx) => {
      if (!input.reason.trim()) throw new AppError(400, 'A reason is required.', 'REASON_REQUIRED');
      const openDisputes = await tx.providerDispute.count({ where: { status: 'OPEN', providerPayment: { userId: input.userId } } });
      const { changed } = await this.financial.liftRestriction(tx, input.userId);
      if (changed)
        await appendAdminAudit(tx, {
          actorUserId: input.actorUserId,
          action: 'WALLET_RESTRICTION_LIFTED',
          entityType: 'WalletAccount',
          entityId: input.userId,
          requestId: input.requestId,
          metadata: { reason: input.reason, openDisputes },
        });
      return { changed };
    });
  }
}
