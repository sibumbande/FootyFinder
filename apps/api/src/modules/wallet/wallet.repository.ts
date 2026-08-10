import { prisma } from '../../database/prisma.js';

export class WalletRepository {
  findByIdempotencyKey(idempotencyKey: string) {
    return prisma.walletTransaction.findUnique({ where: { idempotencyKey }, include: { user: true } });
  }

  createPending(userId: string, amountCents: number, provider: string, idempotencyKey: string) {
    return prisma.walletTransaction.create({
      data: { userId, amountCents, provider, idempotencyKey, type: 'DEPOSIT', status: 'PENDING' },
      include: { user: true },
    });
  }

  async succeed(transactionId: string, userId: string, providerReference: string) {
    return prisma.$transaction(async (tx) => {
      const transaction = await tx.walletTransaction.updateMany({
        where: { id: transactionId, userId, status: 'PENDING' },
        data: { status: 'SUCCEEDED', providerReference },
      });
      if (transaction.count === 1) {
        const deposit = await tx.walletTransaction.findUniqueOrThrow({ where: { id: transactionId } });
        await tx.user.update({ where: { id: userId }, data: { balanceCents: { increment: deposit.amountCents } } });
      }
      return tx.user.findUniqueOrThrow({ where: { id: userId } });
    });
  }

  settle(transactionId: string, status: 'FAILED' | 'ERROR', failureReason: string, providerReference?: string) {
    return prisma.walletTransaction.updateMany({
      where: { id: transactionId, status: 'PENDING' },
      data: { status, failureReason, providerReference },
    });
  }
}
