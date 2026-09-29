import type { Prisma } from '../../generated/prisma/client.js';
import { FinancialRepository } from '../wallet/financial.repository.js';
import { TeamWalletRepository } from './team-wallet.repository.js';

/**
 * Gate 7 (DEC-014, D7/D8): money moving between a member's personal wallet and a Team Wallet.
 * Both legs are written in the caller's serializable transaction, so a transfer is never
 * partial. The team wallet is locked before the personal wallet (see TeamWalletRepository).
 */
export class TeamWalletTransfers {
  constructor(
    private readonly teamWallets = new TeamWalletRepository(),
    private readonly financial = new FinancialRepository(),
  ) {}

  /**
   * Returns a member's own unspent contributions to their personal wallet: a self-refund
   * (CONTRIBUTION_REFUND_DEBIT) or a closure refund (CLOSURE_REFUND_DEBIT). Idempotent by key.
   */
  async refundContributor(
    tx: Prisma.TransactionClient,
    input: {
      teamId: string;
      teamName: string;
      contributorUserId: string;
      amountCents: number;
      type: 'CONTRIBUTION_REFUND_DEBIT' | 'CLOSURE_REFUND_DEBIT';
      idempotencyKey: string;
      actorUserId: string;
    },
  ) {
    await this.teamWallets.lockAccount(tx, input.teamId);
    const description = input.type === 'CLOSURE_REFUND_DEBIT'
      ? `Unspent contributions returned: ${input.teamName} closed`
      : `Contribution refund from ${input.teamName}`;
    const personal = await this.financial.credit(tx, {
      userId: input.contributorUserId,
      amountCents: input.amountCents,
      type: 'TEAM_CONTRIBUTION_REFUND_CREDIT',
      idempotencyKey: `${input.idempotencyKey}:personal`,
      referenceType: 'TEAM',
      referenceId: input.teamId,
      description,
    });
    const team = await this.teamWallets.debit(tx, {
      teamId: input.teamId,
      type: input.type,
      amountCents: input.amountCents,
      idempotencyKey: input.idempotencyKey,
      actorUserId: input.actorUserId,
      contributorUserId: input.contributorUserId,
      linkedWalletTransactionId: personal.transaction.id,
      spendContributionsOf: input.contributorUserId,
      referenceType: 'TEAM',
      referenceId: input.teamId,
      description,
    });
    return { personal, team, replayed: personal.replayed && team.replayed };
  }
}
