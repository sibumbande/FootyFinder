import type { Prisma, WalletTransactionType } from '@prisma/client';
import { AppError } from '../../errors/app-error.js';
import { enqueueDurableJob } from '../../jobs/durable-jobs.js';

export class FinancialInsufficientFundsError extends Error {}
type LedgerInput = {
  userId: string;
  amountCents: number;
  type: WalletTransactionType;
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: string;
  description?: string;
};
const assertLedgerReplay = (
  row: { walletAccountId: string; amountCents: number; type: WalletTransactionType },
  accountId: string,
  signedAmount: number,
  type: WalletTransactionType,
) => {
  if (row.walletAccountId !== accountId || row.amountCents !== signedAmount || row.type !== type)
    throw new AppError(409, 'That financial idempotency key was already used.', 'FINANCIAL_IDEMPOTENCY_CONFLICT');
};

export class FinancialRepository {
  private async lockAccount(tx: Prisma.TransactionClient, userId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "WalletAccount" WHERE "userId" = ${userId}::uuid FOR UPDATE
    `;
    if (!rows[0]) throw new AppError(404, 'Wallet account not found.', 'WALLET_NOT_FOUND');
    return tx.walletAccount.findUniqueOrThrow({ where: { id: rows[0].id } });
  }

  private activeHeldCents(tx: Prisma.TransactionClient, walletAccountId: string, now: Date) {
    return tx.walletHold.aggregate({
      where: { walletAccountId, status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      _sum: { amountCents: true },
    });
  }

  async debit(tx: Prisma.TransactionClient, input: LedgerInput) {
    if (!Number.isInteger(input.amountCents) || input.amountCents < 0)
      throw new AppError(400, 'Debit amount must be zero or greater.', 'FINANCIAL_AMOUNT_INVALID');
    const account = await this.lockAccount(tx, input.userId);
    const signedAmount = -input.amountCents;
    const replay = await tx.walletTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (replay) {
      assertLedgerReplay(replay, account.id, signedAmount, input.type);
      return { account, transaction: replay, replayed: true };
    }
    const held = (await this.activeHeldCents(tx, account.id, new Date()))._sum.amountCents ?? 0;
    if (account.balanceCents - held < input.amountCents) throw new FinancialInsufficientFundsError();
    const transaction = await tx.walletTransaction.create({ data: {
      walletAccountId: account.id, type: input.type, amountCents: signedAmount,
      status: 'SUCCEEDED', idempotencyKey: input.idempotencyKey,
      referenceType: input.referenceType, referenceId: input.referenceId, description: input.description,
    } });
    const updatedAccount = input.amountCents
      ? await tx.walletAccount.update({ where: { id: account.id }, data: { balanceCents: { decrement: input.amountCents } } })
      : account;
    return { account: updatedAccount, transaction, replayed: false };
  }

  async credit(tx: Prisma.TransactionClient, input: LedgerInput) {
    if (!Number.isInteger(input.amountCents) || input.amountCents < 0)
      throw new AppError(400, 'Credit amount must be zero or greater.', 'FINANCIAL_AMOUNT_INVALID');
    const account = await this.lockAccount(tx, input.userId);
    const replay = await tx.walletTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (replay) {
      assertLedgerReplay(replay, account.id, input.amountCents, input.type);
      return { account, transaction: replay, replayed: true };
    }
    const transaction = await tx.walletTransaction.create({ data: {
      walletAccountId: account.id, type: input.type, amountCents: input.amountCents,
      status: 'SUCCEEDED', idempotencyKey: input.idempotencyKey,
      referenceType: input.referenceType, referenceId: input.referenceId, description: input.description,
    } });
    const updatedAccount = input.amountCents
      ? await tx.walletAccount.update({ where: { id: account.id }, data: { balanceCents: { increment: input.amountCents } } })
      : account;
    return { account: updatedAccount, transaction, replayed: false };
  }

  async succeedPendingCredit(
    tx: Prisma.TransactionClient,
    transactionId: string,
    userId: string,
    providerReference: string,
  ) {
    const account = await this.lockAccount(tx, userId);
    const transaction = await tx.walletTransaction.findFirstOrThrow({
      where: { id: transactionId, walletAccountId: account.id },
    });
    if (transaction.status === 'SUCCEEDED') return { account, transaction, replayed: true };
    if (transaction.status !== 'PENDING')
      throw new AppError(409, 'That deposit is already in a terminal state.', 'DEPOSIT_TERMINAL');
    const updatedTransaction = await tx.walletTransaction.update({
      where: { id: transactionId },
      data: { status: 'SUCCEEDED', providerReference },
    });
    const updatedAccount = await tx.walletAccount.update({
      where: { id: account.id },
      data: { balanceCents: { increment: transaction.amountCents } },
    });
    return { account: updatedAccount, transaction: updatedTransaction, replayed: false };
  }

  async settlePending(
    tx: Prisma.TransactionClient,
    transactionId: string,
    status: 'FAILED' | 'ERROR',
    failureReason: string,
    providerReference?: string,
  ) {
    const current = await tx.walletTransaction.findUniqueOrThrow({ where: { id: transactionId } });
    if (current.status === status) return { transaction: current, replayed: true };
    if (current.status !== 'PENDING')
      throw new AppError(409, 'That deposit is already in a terminal state.', 'DEPOSIT_TERMINAL');
    return {
      transaction: await tx.walletTransaction.update({
        where: { id: transactionId },
        data: { status, failureReason, providerReference },
      }),
      replayed: false,
    };
  }

  async createHold(tx: Prisma.TransactionClient, input: Omit<LedgerInput, 'type'> & { expiresAt?: Date }) {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0)
      throw new AppError(400, 'Hold amount must be positive.', 'FINANCIAL_AMOUNT_INVALID');
    const account = await this.lockAccount(tx, input.userId);
    const replay = await tx.walletHold.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (replay) {
      if (replay.walletAccountId !== account.id || replay.amountCents !== input.amountCents)
        throw new AppError(409, 'That hold idempotency key was already used.', 'FINANCIAL_IDEMPOTENCY_CONFLICT');
      return { hold: replay, replayed: true };
    }
    const held = (await this.activeHeldCents(tx, account.id, new Date()))._sum.amountCents ?? 0;
    if (account.balanceCents - held < input.amountCents) throw new FinancialInsufficientFundsError();
    const hold = await tx.walletHold.create({ data: {
      walletAccountId: account.id, amountCents: input.amountCents, idempotencyKey: input.idempotencyKey,
      referenceType: input.referenceType ?? 'UNSPECIFIED', referenceId: input.referenceId ?? input.idempotencyKey,
      description: input.description, expiresAt: input.expiresAt,
    } });
    if (input.expiresAt)
      await enqueueDurableJob(tx, {
        type: 'WALLET_HOLD_EXPIRE',
        dedupeKey: `wallet-hold-expire:${hold.id}`,
        payload: { holdId: hold.id },
        runAt: input.expiresAt,
      });
    return { hold, replayed: false };
  }

  async captureHold(tx: Prisma.TransactionClient, holdId: string, ledger: Pick<LedgerInput, 'type' | 'idempotencyKey' | 'description'>) {
    const found = await tx.walletHold.findUnique({ where: { id: holdId }, include: { walletAccount: true } });
    if (!found) throw new AppError(404, 'Wallet hold not found.', 'WALLET_HOLD_NOT_FOUND');
    const account = await this.lockAccount(tx, found.walletAccount.userId);
    const current = await tx.walletHold.findUniqueOrThrow({ where: { id: holdId } });
    if (current.status === 'CAPTURED') {
      const transaction = await tx.walletTransaction.findUnique({ where: { idempotencyKey: ledger.idempotencyKey } });
      if (!transaction) throw new AppError(409, 'Captured hold ledger is missing.', 'FINANCIAL_INTEGRITY_ERROR');
      return { hold: current, transaction, replayed: true };
    }
    if (current.status !== 'ACTIVE') throw new AppError(409, 'Wallet hold is no longer active.', 'WALLET_HOLD_INACTIVE');
    if (current.expiresAt && current.expiresAt <= new Date()) {
      throw new AppError(409, 'Wallet hold has expired.', 'WALLET_HOLD_EXPIRED');
    }
    if (account.balanceCents < current.amountCents) throw new FinancialInsufficientFundsError();
    const transaction = await tx.walletTransaction.create({ data: {
      walletAccountId: current.walletAccountId, type: ledger.type, amountCents: -current.amountCents,
      status: 'SUCCEEDED', idempotencyKey: ledger.idempotencyKey,
      referenceType: current.referenceType, referenceId: current.referenceId, description: ledger.description,
    } });
    await tx.walletAccount.update({ where: { id: current.walletAccountId }, data: { balanceCents: { decrement: current.amountCents } } });
    const hold = await tx.walletHold.update({ where: { id: holdId }, data: { status: 'CAPTURED', capturedAt: new Date() } });
    return { hold, transaction, replayed: false };
  }

  async releaseHold(tx: Prisma.TransactionClient, holdId: string, expired = false) {
    const found = await tx.walletHold.findUnique({ where: { id: holdId }, include: { walletAccount: true } });
    if (!found) throw new AppError(404, 'Wallet hold not found.', 'WALLET_HOLD_NOT_FOUND');
    await this.lockAccount(tx, found.walletAccount.userId);
    const current = await tx.walletHold.findUniqueOrThrow({ where: { id: holdId } });
    if (current.status === 'RELEASED' || current.status === 'EXPIRED') return { hold: current, replayed: true };
    if (current.status === 'CAPTURED') throw new AppError(409, 'A captured hold cannot be released.', 'WALLET_HOLD_CAPTURED');
    return { hold: await tx.walletHold.update({ where: { id: holdId }, data: { status: expired ? 'EXPIRED' : 'RELEASED', releasedAt: new Date() } }), replayed: false };
  }
}
