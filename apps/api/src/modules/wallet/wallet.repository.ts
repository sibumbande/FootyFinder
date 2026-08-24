import type { Notification } from '@prisma/client';
import { prisma } from '../../database/prisma.js';
import {
  notificationDedupeKey,
  persistNotifications,
} from '../notifications/notification-writer.js';
import { safeUserInclude } from '../users/users.repository.js';

export class WalletRepository {
  findByIdempotencyKey(idempotencyKey: string) {
    return prisma.walletTransaction.findUnique({
      where: { idempotencyKey },
      include: { walletAccount: { include: { user: { include: safeUserInclude } } } },
    });
  }
  async createPending(
    userId: string,
    amountCents: number,
    provider: string,
    idempotencyKey: string,
  ) {
    const account = await prisma.walletAccount.findUniqueOrThrow({ where: { userId } });
    return prisma.walletTransaction.create({
      data: {
        walletAccountId: account.id,
        amountCents,
        provider,
        idempotencyKey,
        type: 'DEPOSIT_CREDIT',
        status: 'PENDING',
        referenceType: 'DEPOSIT',
        description: 'Wallet deposit',
      },
    });
  }
  async succeed(transactionId: string, userId: string, providerReference: string) {
    return prisma.$transaction(async (tx) => {
      const account = await tx.walletAccount.findUniqueOrThrow({ where: { userId } });
      const transition = await tx.walletTransaction.updateMany({
        where: { id: transactionId, walletAccountId: account.id, status: 'PENDING' },
        data: { status: 'SUCCEEDED', providerReference },
      });
      let notifications: Notification[] = [];
      if (transition.count === 1) {
        const creditedTransaction = await tx.walletTransaction.findUniqueOrThrow({
          where: { id: transactionId },
        });
        await tx.walletAccount.update({
          where: { id: account.id },
          data: {
            balanceCents: { increment: creditedTransaction.amountCents },
          },
        });
        notifications = await persistNotifications(tx, [
          {
            userId,
            type: 'DEPOSIT_SUCCEEDED',
            title: 'Deposit received',
            message: `R${(creditedTransaction.amountCents / 100).toFixed(2)} was added to your Footy Finder wallet.`,
            targetPath: '/',
            dedupeKey: notificationDedupeKey(
              'wallet-transaction',
              transactionId,
              'deposit-succeeded',
              userId,
            ),
          },
        ]);
      }
      return {
        user: await tx.user.findUniqueOrThrow({ where: { id: userId }, include: safeUserInclude }),
        notifications,
      };
    });
  }
  settle(
    transactionId: string,
    status: 'FAILED' | 'ERROR',
    failureReason: string,
    providerReference?: string,
  ) {
    return prisma.walletTransaction.updateMany({
      where: { id: transactionId, status: 'PENDING' },
      data: { status, failureReason, providerReference },
    });
  }
}
