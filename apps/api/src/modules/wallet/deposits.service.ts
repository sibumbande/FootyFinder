import type { DepositResponse } from '@footy-finder/shared';
import { AppError } from '../../errors/app-error.js';
import { toAuthenticatedUser } from '../users/user.mapper.js';
import type { PaymentOperator } from './payment-operator.js';
import { WalletRepository } from './wallet.repository.js';

export class DepositsService {
  constructor(
    private readonly operator: PaymentOperator,
    private readonly wallet = new WalletRepository(),
  ) {}

  async deposit(userId: string, amountCents: number, idempotencyKey: string): Promise<DepositResponse> {
    if (!idempotencyKey || idempotencyKey.length > 200) {
      throw new AppError(400, 'A valid Idempotency-Key header is required.', 'IDEMPOTENCY_KEY_REQUIRED');
    }
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new AppError(400, 'Deposit amount must be a positive number of cents.', 'INVALID_DEPOSIT_AMOUNT');
    }

    const existing = await this.wallet.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      if (existing.userId !== userId || existing.amountCents !== amountCents || existing.provider !== this.operator.name) {
        throw new AppError(409, 'That idempotency key was used for a different deposit.', 'IDEMPOTENCY_KEY_REUSED');
      }
      if (existing.status === 'SUCCEEDED') {
        return { status: 'success', transactionId: existing.id, user: toAuthenticatedUser(existing.user) };
      }
      if (existing.status === 'FAILED') return { status: 'failure', transactionId: existing.id, message: existing.failureReason ?? 'Payment declined.' };
      if (existing.status === 'ERROR') return { status: 'error', transactionId: existing.id, message: existing.failureReason ?? 'Payment provider error.' };
      throw new AppError(409, 'This deposit is still being processed.', 'DEPOSIT_PENDING');
    }

    const transaction = await this.wallet.createPending(userId, amountCents, this.operator.name, idempotencyKey);
    let result;
    try {
      result = await this.operator.deposit({ amountCents, currency: 'ZAR', customerId: userId, idempotencyKey });
    } catch (error) {
      result = { status: 'error' as const, message: error instanceof Error ? error.message : 'Payment provider error.' };
    }

    if (result.status === 'success') {
      const user = await this.wallet.succeed(transaction.id, userId, result.providerReference);
      return { status: 'success', transactionId: transaction.id, user: toAuthenticatedUser(user) };
    }

    await this.wallet.settle(
      transaction.id,
      result.status === 'failure' ? 'FAILED' : 'ERROR',
      result.message,
      result.providerReference,
    );
    return { status: result.status, transactionId: transaction.id, message: result.message };
  }
}
