import { randomUUID } from 'node:crypto';
import type { TopUpInitiation, TopUpStatus } from '@footy-finder/shared';
import type { ProviderPayment } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { enqueueDurableJob } from '../../jobs/durable-jobs.js';
import { logError } from '../../observability/logger.js';
import { FinancialRepository } from '../wallet/financial.repository.js';
import { demoDepositsEnabled } from '../wallet/payment-config.js';
import {
  isPaystackCheckoutUrl,
  PaystackClient,
  PaystackError,
  type PaystackGateway,
} from './paystack.client.js';
import { TopUpSettlementService } from './top-up-settlement.service.js';

export const TOP_UP_EXPIRE_JOB_TYPE = 'PAYSTACK_TOP_UP_EXPIRE';
export const PAYSTACK_PROVIDER = 'paystack';
/** The status check re-verifies with Paystack at most this often per top-up. */
export const STATUS_CHECK_MIN_INTERVAL_MS = 5_000;

export const toTopUpStatus = (payment: ProviderPayment): TopUpStatus => ({
  reference: payment.reference,
  amountCents: payment.amountCents,
  currency: 'ZAR',
  state: payment.status === 'SUCCEEDED' ? 'SUCCEEDED' : payment.status === 'FAILED' ? 'FAILED' : 'PROCESSING',
  underReview: payment.status === 'REVIEW',
  createdAt: payment.createdAt.toISOString(),
});

export class TopUpService {
  constructor(
    private readonly gateway: PaystackGateway = new PaystackClient(),
    private readonly settlement = new TopUpSettlementService(gateway),
    private readonly financial = new FinancialRepository(),
    private readonly config: { clientUrl: string; expiryMinutes: number; paystackEnabled: () => boolean } = {
      clientUrl: env.CLIENT_URL,
      expiryMinutes: env.TOP_UP_PENDING_EXPIRY_MINUTES,
      paystackEnabled: () => !demoDepositsEnabled() && Boolean(env.PAYSTACK_SECRET_KEY),
    },
  ) {}

  /**
   * Starts a Paystack hosted-checkout top-up. Creates the PENDING ledger row and its
   * ProviderPayment atomically (idempotent per user + Idempotency-Key), then asks Paystack for a
   * checkout URL. Nothing here credits the wallet.
   */
  async initiate(userId: string, amountCents: number, idempotencyKey: string): Promise<TopUpInitiation> {
    if (!this.config.paystackEnabled())
      throw new AppError(409, 'Card top-ups are not enabled in this environment.', 'CARD_TOP_UPS_DISABLED');
    if (!idempotencyKey || idempotencyKey.length > 200)
      throw new AppError(400, 'A valid Idempotency-Key header is required.', 'IDEMPOTENCY_KEY_REQUIRED');
    const ledgerKey = `paystack-topup:${userId}:${idempotencyKey}`;
    const now = new Date();

    let payment = await serializableTransaction(async (tx) => {
      const existing = await tx.walletTransaction.findUnique({
        where: { idempotencyKey: ledgerKey },
        include: { providerPayment: true },
      });
      if (existing) {
        if (!existing.providerPayment || existing.amountCents !== amountCents)
          throw new AppError(409, 'That idempotency key was used for a different top-up.', 'IDEMPOTENCY_KEY_REUSED');
        return existing.providerPayment;
      }
      const account = await tx.walletAccount.findUnique({ where: { userId } });
      if (!account) throw new AppError(404, 'Wallet account not found.', 'WALLET_NOT_FOUND');
      const paymentId = randomUUID();
      const ledger = await tx.walletTransaction.create({
        data: {
          walletAccountId: account.id,
          type: 'DEPOSIT_CREDIT',
          amountCents,
          status: 'PENDING',
          provider: PAYSTACK_PROVIDER,
          idempotencyKey: ledgerKey,
          referenceType: 'PROVIDER_PAYMENT',
          referenceId: paymentId,
          description: 'Card top-up',
        },
      });
      const created = await tx.providerPayment.create({
        data: {
          id: paymentId,
          userId,
          walletTransactionId: ledger.id,
          provider: PAYSTACK_PROVIDER,
          reference: `ff_topup_${randomUUID().replaceAll('-', '')}`,
          amountCents,
        },
      });
      await enqueueDurableJob(tx, {
        type: TOP_UP_EXPIRE_JOB_TYPE,
        dedupeKey: `paystack-topup-expire:${created.id}:0`,
        payload: { providerPaymentId: created.id, attempt: 0 },
        runAt: new Date(now.getTime() + this.config.expiryMinutes * 60_000),
      });
      return created;
    });

    if (payment.userId !== userId) throw new AppError(409, 'That idempotency key was used for a different top-up.', 'IDEMPOTENCY_KEY_REUSED');
    if (payment.authorizationUrl || payment.status !== 'INITIALIZED') return this.initiation(payment);

    // Only the request that claims initialisation talks to Paystack; a concurrent retry waits.
    const claim = await prisma.providerPayment.updateMany({
      where: { id: payment.id, initializeStartedAt: null },
      data: { initializeStartedAt: new Date() },
    });
    if (claim.count !== 1)
      throw new AppError(409, 'This top-up is still being prepared. Try again in a moment.', 'TOP_UP_IN_PROGRESS');

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    try {
      const checkout = await this.gateway.initialize({
        email: user.email,
        amountCents: payment.amountCents,
        reference: payment.reference,
        callbackUrl: `${this.config.clientUrl.replace(/\/$/, '')}/wallet/top-up/return`,
        metadata: { providerPaymentId: payment.id, userId },
      });
      if (!isPaystackCheckoutUrl(checkout.authorizationUrl))
        throw new PaystackError('PAYSTACK_REJECTED', 'The payment provider returned an unexpected checkout address.');
      payment = await prisma.providerPayment.update({
        where: { id: payment.id },
        data: { authorizationUrl: checkout.authorizationUrl },
      });
      return this.initiation(payment);
    } catch (error) {
      // No checkout URL reached the player, so the top-up cannot be paid: close it. If Paystack
      // ever reports it paid anyway, the settlement path routes it to finance review.
      const reason = error instanceof PaystackError ? error.code : 'initialize_error';
      await serializableTransaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "ProviderPayment" WHERE "id" = ${payment.id}::uuid FOR UPDATE`;
        const current = await tx.providerPayment.findUniqueOrThrow({ where: { id: payment.id } });
        if (current.status !== 'INITIALIZED') return;
        await this.financial.settlePending(tx, current.walletTransactionId, 'ERROR', 'Card checkout could not be started.');
        await tx.providerPayment.update({ where: { id: current.id }, data: { status: 'FAILED', failureReason: reason } });
      });
      logError('top_up_initialize_failed', error, { paymentId: payment.id });
      throw new AppError(502, 'Card payments are unavailable right now. Please try again.', 'PAYMENT_PROVIDER_UNAVAILABLE');
    }
  }

  /**
   * The player's own top-up status. While it is still open this re-verifies with Paystack from our
   * server (at most every few seconds), which may credit through the shared settlement path. The
   * browser never supplies payment facts.
   */
  async status(userId: string, reference: string, now = new Date()): Promise<TopUpStatus> {
    const payment = await prisma.providerPayment.findFirst({ where: { reference, userId } });
    if (!payment) throw new AppError(404, 'Top-up not found.', 'TOP_UP_NOT_FOUND');
    const due =
      !payment.lastVerifiedAt || now.getTime() - payment.lastVerifiedAt.getTime() >= STATUS_CHECK_MIN_INTERVAL_MS;
    if (payment.status !== 'INITIALIZED' || !payment.authorizationUrl || !due) return toTopUpStatus(payment);
    try {
      await this.settlement.settleFromVerify(reference, 'status_check', { now, finalAttempt: false });
    } catch (error) {
      logError('top_up_status_check_failed', error, { paymentId: payment.id });
    }
    return toTopUpStatus(await prisma.providerPayment.findUniqueOrThrow({ where: { id: payment.id } }));
  }

  private initiation(payment: ProviderPayment): TopUpInitiation {
    return {
      ...toTopUpStatus(payment),
      ...(payment.status === 'INITIALIZED' && payment.authorizationUrl && { authorizationUrl: payment.authorizationUrl }),
    };
  }
}
