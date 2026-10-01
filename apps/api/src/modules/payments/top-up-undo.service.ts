import type { UndoableTopUp } from '@footy-finder/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import { AppError } from '../../errors/app-error.js';
import { CardRefundsService } from './card-refunds.service.js';

export const TOP_UP_UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;
// Money movements that are not spending: top-ups themselves and refunds of top-ups.
const NOT_SPENDING = ['DEPOSIT', 'DEPOSIT_CREDIT', 'TOP_UP_REFUND_DEBIT', 'TOP_UP_REFUND_RESTORE_CREDIT'] as const;
type Db = Prisma.TransactionClient | typeof prisma;
type Payment = { id: string; userId: string; amountCents: number; status: string; verifiedAt: Date | null; refunds: Array<{ status: string; amountCents: number; source: string }> };

/**
 * CEO touch-up batch 3, item 6b (D7): how much of a top-up the player may undo. The top-up, minus what was
 * already refunded from it, minus the net amount spent since it was credited (match fees and team contributions,
 * less any money that came back from them), and never more than the wallet's available balance.
 * Example: R100 in the wallet, a R800 top-up (R900), then a R80 match: undo returns up to R720.
 */
export async function refundableForUndo(db: Db, payment: Payment) {
  if (!payment.verifiedAt) return 0;
  const committed = payment.refunds.filter((item) => item.status !== 'RESTORED_TO_WALLET').reduce((sum, item) => sum + item.amountCents, 0);
  const wallet = await db.walletAccount.findUniqueOrThrow({
    where: { userId: payment.userId },
    select: { id: true, balanceCents: true, holds: { where: { status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { amountCents: true } } },
  });
  const movements = await db.walletTransaction.aggregate({
    where: { walletAccountId: wallet.id, status: 'SUCCEEDED', createdAt: { gte: payment.verifiedAt }, type: { notIn: [...NOT_SPENDING] } },
    _sum: { amountCents: true },
  });
  const spentSince = Math.max(0, -(movements._sum.amountCents ?? 0));
  const available = wallet.balanceCents - wallet.holds.reduce((sum, hold) => sum + hold.amountCents, 0);
  return Math.max(0, Math.min(payment.amountCents - committed - spentSince, available));
}

export class TopUpUndoService {
  constructor(private readonly refunds = new CardRefundsService()) {}

  /** The player's top-ups from the last 24 hours, with how much each can still be undone. */
  async undoable(userId: string, now = new Date()): Promise<UndoableTopUp[]> {
    const restricted = (await prisma.walletAccount.findUnique({ where: { userId }, select: { spendingRestrictedAt: true } }))?.spendingRestrictedAt;
    const payments = await prisma.providerPayment.findMany({
      where: { userId, status: 'SUCCEEDED', verifiedAt: { gt: new Date(now.getTime() - TOP_UP_UNDO_WINDOW_MS) } },
      include: { refunds: true, disputes: { select: { id: true } } },
      orderBy: { verifiedAt: 'desc' },
    });
    return Promise.all(payments.map(async (payment) => {
      const alreadyUndone = payment.refunds.some(({ source }) => source === 'PLAYER_UNDO');
      const blocked = alreadyUndone ? 'ALREADY_UNDONE' : restricted ? 'WALLET_RESTRICTED' : payment.disputes.length ? 'DISPUTED' : null;
      return {
        paymentId: payment.id,
        amountCents: payment.amountCents,
        creditedAt: payment.verifiedAt!.toISOString(),
        undoUntil: new Date(payment.verifiedAt!.getTime() + TOP_UP_UNDO_WINDOW_MS).toISOString(),
        refundableCents: blocked ? 0 : await refundableForUndo(prisma, payment),
        blockedReason: blocked,
      };
    }));
  }

  /** Refunds part or all of a recent top-up to the same card, once per top-up (idempotent, race-safe). */
  undo(userId: string, paymentId: string, amountCents: number, idempotencyKey: string, now = new Date()) {
    return this.refunds.initiate({
      actorUserId: userId,
      providerPaymentId: paymentId,
      amountCents,
      reason: 'Undo top-up (player)',
      idempotencyKey: `player-undo:${idempotencyKey}`,
      source: 'PLAYER_UNDO',
      assertAllowed: async (tx, payment) => {
        if (payment.userId !== userId) throw new AppError(404, 'Top-up not found.', 'TOP_UP_NOT_FOUND');
        if (!payment.verifiedAt || now.getTime() - payment.verifiedAt.getTime() > TOP_UP_UNDO_WINDOW_MS)
          throw new AppError(409, 'A top-up can only be undone within 24 hours.', 'TOP_UP_UNDO_EXPIRED');
        if (payment.refunds.some(({ source }) => source === 'PLAYER_UNDO'))
          throw new AppError(409, 'This top-up has already been undone once.', 'TOP_UP_ALREADY_UNDONE');
        const wallet = await tx.walletAccount.findUniqueOrThrow({ where: { userId }, select: { spendingRestrictedAt: true } });
        if (wallet.spendingRestrictedAt)
          throw new AppError(409, 'Your wallet is restricted, so top-ups cannot be undone. Contact support.', 'WALLET_RESTRICTED');
        const refundable = await refundableForUndo(tx, payment);
        if (amountCents > refundable)
          throw new AppError(409, `You can undo at most R${(refundable / 100).toFixed(2)} of this top-up.`, 'REFUND_EXCEEDS_AVAILABLE', { refundableCents: refundable });
      },
    });
  }
}
