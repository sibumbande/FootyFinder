import { describe, expect, it, vi } from 'vitest';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { PaymentOperator } from './payment-operator.js';
import { DepositsService } from './deposits.service.js';
import type { WalletRepository } from './wallet.repository.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const user = {
  id: '4a5529e6-4289-4f0a-94b7-233950def34d',
  email: 'wallet@example.com',
  username: 'wallet_player',
  passwordHash: 'hidden',
  profile: {
    displayName: 'Wallet Player',
    avatarUrl: null,
    bio: null,
    dominantFoot: null,
    homeArea: null,
    preferredPositions: [],
    createdAt: now,
    updatedAt: now,
  },
  walletAccount: { balanceCents: 50_000, currency: 'ZAR' },
  createdAt: now,
  updatedAt: now,
};
const transaction = {
  id: 'f204f78c-6dbe-4af1-a576-a904230a09b0',
  userId: user.id,
  amountCents: 50_000,
  provider: 'test-provider',
  idempotencyKey: 'deposit-1',
  type: 'DEPOSIT' as const,
  status: 'PENDING' as const,
  providerReference: null,
  matchId: null,
  failureReason: null,
  createdAt: now,
  updatedAt: now,
  user,
};

function setup(result: Awaited<ReturnType<PaymentOperator['deposit']>> | Error) {
  const operator: PaymentOperator = {
    name: 'test-provider',
    deposit:
      result instanceof Error
        ? vi.fn().mockRejectedValue(result)
        : vi.fn().mockResolvedValue(result),
  };
  const wallet = {
    findByIdempotencyKey: vi.fn().mockResolvedValue(null),
    createPending: vi.fn().mockResolvedValue({ transaction, created: true }),
    succeed: vi.fn().mockResolvedValue({ user, notifications: [] }),
    settle: vi.fn().mockResolvedValue({ count: 1 }),
  } as unknown as WalletRepository;
  const notifications = {
    publishPersistedMany: vi.fn(),
  } as unknown as NotificationsService;
  return {
    operator,
    wallet,
    notifications,
    service: new DepositsService(operator, wallet, notifications),
  };
}

describe('DepositsService', () => {
  it('credits a successful payment only through the success transition', async () => {
    const { service, wallet, notifications } = setup({
      status: 'success',
      providerReference: 'provider-payment-1',
    });
    await expect(service.deposit(user.id, 50_000, 'deposit-1')).resolves.toMatchObject({
      status: 'success',
      user: { balanceCents: 50_000 },
    });
    expect(wallet.succeed).toHaveBeenCalledWith(transaction.id, user.id, 'provider-payment-1');
    expect(notifications.publishPersistedMany).toHaveBeenCalledWith([]);
    expect(wallet.settle).not.toHaveBeenCalled();
  });

  it('records a declined payment without crediting the wallet', async () => {
    const { service, wallet } = setup({ status: 'failure', message: 'Card declined.' });
    await expect(service.deposit(user.id, 50_000, 'deposit-1')).resolves.toMatchObject({
      status: 'failure',
      message: 'Card declined.',
    });
    expect(wallet.succeed).not.toHaveBeenCalled();
    expect(wallet.settle).toHaveBeenCalledWith(
      transaction.id,
      'FAILED',
      'Card declined.',
      undefined,
    );
  });

  it('turns an operator exception into an error state without crediting the wallet', async () => {
    const { service, wallet } = setup(new Error('Provider unavailable.'));
    await expect(service.deposit(user.id, 50_000, 'deposit-1')).resolves.toMatchObject({
      status: 'error',
      message: 'Provider unavailable.',
    });
    expect(wallet.succeed).not.toHaveBeenCalled();
    expect(wallet.settle).toHaveBeenCalledWith(
      transaction.id,
      'ERROR',
      'Provider unavailable.',
      undefined,
    );
  });
});
