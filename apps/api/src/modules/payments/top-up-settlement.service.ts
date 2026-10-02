import type { PaymentChannel } from '@footy-finder/shared';
import type { Notification, Prisma, ProviderPayment } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { logInfo } from '../../observability/logger.js';
import { incrementOperationalMetric } from '../../observability/operational-metrics.js';
import { notificationDedupeKey, persistNotifications } from '../notifications/notification-writer.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { FinancialRepository } from '../wallet/financial.repository.js';
import {
  PaystackClient,
  PaystackError,
  type PaystackGateway,
  type PaystackVerifiedTransaction,
} from './paystack.client.js';

export type SettlementSource = 'webhook' | 'expiry_job' | 'status_check';

export type VerificationOutcome =
  | { kind: 'CREDIT' }
  | { kind: 'FAIL'; reason: string }
  | { kind: 'WAIT' }
  | { kind: 'REVIEW'; reason: string };

type PaymentFacts = Pick<ProviderPayment, 'id' | 'userId' | 'reference' | 'amountCents' | 'createdAt'>;

/**
 * Decides what a Paystack verify result means for one top-up. A credit needs every fact to match
 * our own record: status success, same reference, exact amount, ZAR, an offered channel, and (when
 * present) the metadata we sent at initialisation.
 */
export function evaluateVerification(
  payment: PaymentFacts,
  verified: PaystackVerifiedTransaction | null,
  options: { finalAttempt: boolean; channels?: readonly PaymentChannel[] },
): VerificationOutcome {
  if (!verified) return options.finalAttempt ? { kind: 'FAIL', reason: 'not_found_at_provider' } : { kind: 'WAIT' };
  if (verified.reference !== payment.reference) return { kind: 'REVIEW', reason: 'reference_mismatch' };
  if (verified.status === 'success') {
    if (verified.amountCents !== payment.amountCents) return { kind: 'REVIEW', reason: 'amount_mismatch' };
    if (verified.currency !== 'ZAR') return { kind: 'REVIEW', reason: 'currency_mismatch' };
    // CEO touch-up batch 4, item 3 (D7): only a channel FootyFinder offers (PAYSTACK_CHANNELS) is credited.
    if (!verified.channel || !(options.channels ?? env.PAYSTACK_CHANNELS).includes(verified.channel as PaymentChannel))
      return { kind: 'REVIEW', reason: 'channel_not_offered' };
    const { providerPaymentId, userId } = verified.metadata;
    if (providerPaymentId !== undefined && providerPaymentId !== payment.id)
      return { kind: 'REVIEW', reason: 'metadata_payment_mismatch' };
    if (userId !== undefined && userId !== payment.userId) return { kind: 'REVIEW', reason: 'metadata_user_mismatch' };
    return { kind: 'CREDIT' };
  }
  if (verified.status === 'failed' || verified.status === 'reversed') return { kind: 'FAIL', reason: verified.status };
  if (options.finalAttempt)
    return verified.status === 'abandoned'
      ? { kind: 'FAIL', reason: 'abandoned' }
      : { kind: 'REVIEW', reason: `still_${verified.status || 'unknown'}_after_max_age` };
  return { kind: 'WAIT' };
}

export interface SettlementResult {
  status: ProviderPayment['status'];
  credited: boolean;
  outcome: VerificationOutcome['kind'] | 'REPLAYED';
}

export class TopUpSettlementService {
  constructor(
    private readonly gateway: PaystackGateway = new PaystackClient(),
    private readonly financial = new FinancialRepository(),
    private readonly notifications = new NotificationsService(),
    /** CEO touch-up batch 4, item 3: the channels credited (PAYSTACK_CHANNELS unless a smoke passes its own). */
    private readonly channels?: readonly PaymentChannel[],
  ) {}

  /**
   * The only path that credits a Paystack top-up. The webhook, the expiry job and the player's
   * status check all call it; each one verifies with Paystack from our server, then credits inside
   * a serializable transaction holding the ProviderPayment row lock, through the idempotent
   * PENDING -> SUCCEEDED ledger transition. However they interleave, a top-up is credited once.
   */
  async settleFromVerify(
    reference: string,
    source: SettlementSource,
    options: { finalAttempt?: boolean; now?: Date } = {},
  ): Promise<SettlementResult> {
    const now = options.now ?? new Date();
    const payment = await prisma.providerPayment.findUnique({ where: { reference } });
    if (!payment) throw Object.assign(new Error('Unknown top-up reference.'), { code: 'TOP_UP_NOT_FOUND' });
    if (payment.status === 'SUCCEEDED' || payment.status === 'REVIEW')
      return { status: payment.status, credited: false, outcome: 'REPLAYED' };

    let verified: PaystackVerifiedTransaction | null;
    try {
      verified = await this.gateway.verify(reference);
    } catch (error) {
      if (!(error instanceof PaystackError) || error.code !== 'PAYSTACK_NOT_FOUND') throw error;
      verified = null;
    }
    const maxAgeMs = env.TOP_UP_MAX_PENDING_HOURS * 3_600_000;
    const finalAttempt = options.finalAttempt ?? now.getTime() - payment.createdAt.getTime() >= maxAgeMs;
    const outcome = evaluateVerification(payment, verified, { finalAttempt, channels: this.channels });

    const result = await serializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ProviderPayment" WHERE "id" = ${payment.id}::uuid FOR UPDATE`;
      const current = await tx.providerPayment.findUniqueOrThrow({ where: { id: payment.id } });
      const observed: Prisma.ProviderPaymentUpdateInput = {
        lastVerifiedAt: now,
        ...(verified && {
          providerStatus: verified.status.slice(0, 40),
          providerTransactionId: verified.id || undefined,
          channel: verified.channel?.slice(0, 40),
        }),
      };
      let notifications: Notification[] = [];

      if (current.status === 'SUCCEEDED' || current.status === 'REVIEW') {
        return { status: current.status, credited: false, outcome: 'REPLAYED' as const, notifications };
      }
      if (current.status === 'FAILED') {
        // A success reported after we closed the top-up is money we received without a credit:
        // it goes to finance review, never to an automatic credit.
        if (outcome.kind !== 'CREDIT')
          return { status: current.status, credited: false, outcome: 'REPLAYED' as const, notifications };
        await tx.providerPayment.update({
          where: { id: current.id },
          data: { ...observed, status: 'REVIEW', reviewReason: 'late_success_after_failed' },
        });
        return { status: 'REVIEW' as const, credited: false, outcome: 'REVIEW' as const, notifications };
      }

      if (outcome.kind === 'CREDIT') {
        const transition = await this.financial.succeedPendingCredit(
          tx,
          current.walletTransactionId,
          current.userId,
          current.reference,
        );
        await tx.providerPayment.update({
          where: { id: current.id },
          data: { ...observed, status: 'SUCCEEDED', verifiedAt: now, creditedBy: source },
        });
        if (!transition.replayed)
          notifications = await persistNotifications(tx, [
            {
              userId: current.userId,
              type: 'DEPOSIT_SUCCEEDED',
              title: 'Top-up received',
              message: `R${(current.amountCents / 100).toFixed(2)} was added to your Footy Finder wallet.`,
              targetPath: '/wallet',
              dedupeKey: notificationDedupeKey('provider-payment', current.id, 'credited', current.userId),
            },
          ]);
        return { status: 'SUCCEEDED' as const, credited: !transition.replayed, outcome: 'CREDIT' as const, notifications };
      }
      if (outcome.kind === 'FAIL') {
        await this.financial.settlePending(tx, current.walletTransactionId, 'FAILED', `Card payment ${outcome.reason}.`, current.reference);
        await tx.providerPayment.update({
          where: { id: current.id },
          data: { ...observed, status: 'FAILED', failureReason: outcome.reason },
        });
        return { status: 'FAILED' as const, credited: false, outcome: 'FAIL' as const, notifications };
      }
      if (outcome.kind === 'REVIEW') {
        await tx.providerPayment.update({
          where: { id: current.id },
          data: { ...observed, status: 'REVIEW', reviewReason: outcome.reason },
        });
        return { status: 'REVIEW' as const, credited: false, outcome: 'REVIEW' as const, notifications };
      }
      await tx.providerPayment.update({ where: { id: current.id }, data: observed });
      return { status: 'INITIALIZED' as const, credited: false, outcome: 'WAIT' as const, notifications };
    });

    this.notifications.publishPersistedMany(result.notifications);
    if (result.credited) incrementOperationalMetric('top_up_credited_total');
    if (result.outcome === 'REVIEW') incrementOperationalMetric('top_up_review_total');
    logInfo('top_up_settlement', { source, outcome: result.outcome, paymentId: payment.id });
    return { status: result.status, credited: result.credited, outcome: result.outcome };
  }
}
