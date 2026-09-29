import type { Notification } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import {
  notificationDedupeKey,
  persistNotifications,
} from '../notifications/notification-writer.js';
import { safeUserInclude } from '../users/users.repository.js';
import { serializableTransaction } from '../../database/transaction.js';
import { FinancialRepository } from './financial.repository.js';

export class WalletRepository {
  constructor(private readonly financial = new FinancialRepository()) {}
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
    return serializableTransaction(async (tx) => {
      const account = await tx.walletAccount.findUniqueOrThrow({ where: { userId } });
      const inserted = await tx.walletTransaction.createMany({
        data: [{
          walletAccountId: account.id,
          amountCents,
          provider,
          idempotencyKey,
          type: 'DEPOSIT_CREDIT',
          status: 'PENDING',
          referenceType: 'DEPOSIT',
          description: 'Wallet deposit',
        }],
        skipDuplicates: true,
      });
      const transaction = await tx.walletTransaction.findUniqueOrThrow({
        where: { idempotencyKey },
        include: { walletAccount: { include: { user: { include: safeUserInclude } } } },
      });
      return { transaction, created: inserted.count === 1 };
    });
  }
  async succeed(transactionId: string, userId: string, providerReference: string) {
    return serializableTransaction(async (tx) => {
      const transition = await this.financial.succeedPendingCredit(
        tx,
        transactionId,
        userId,
        providerReference,
      );
      let notifications: Notification[] = [];
      if (!transition.replayed) {
        const creditedTransaction = transition.transaction;
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
    return serializableTransaction((tx) =>
      this.financial.settlePending(
        tx,
        transactionId,
        status,
        failureReason,
        providerReference,
      ),
    );
  }
}
