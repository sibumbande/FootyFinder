import type {
  Prisma,
  TeamSide,
  TeamWalletTransactionType,
} from '../../generated/prisma/client.js';
import { AppError } from '../../errors/app-error.js';

/**
 * Gate 7 / TKT-701 (DEC-014, DEC-019): the only writer of Team Wallet money.
 *
 * - The balance is the sum of the team's immutable ledger rows and is updated in the same
 *   transaction as the row that changes it; nothing else edits it.
 * - Every write is idempotent by key, and a reused key with different money facts is refused.
 * - Holds (fill-meter money) reduce the available balance; they are captured only when a match
 *   goes ahead and are otherwise released (D2).
 * - Every debit is allocated to the contributions it spends, oldest first (D8), so the sum of
 *   unspent contributions always equals the balance and closure can return each member's own
 *   unspent money (D7).
 *
 * Lock order (callers must follow it): Match row, Team row, TeamWalletAccount rows (by id),
 * then personal WalletAccount rows.
 */
export class TeamWalletInsufficientFundsError extends AppError {
  constructor(message = 'There is not enough available money in the team wallet.') {
    super(409, message, 'TEAM_WALLET_INSUFFICIENT_FUNDS');
  }
}

const PERSONAL_LINKED_TYPES = new Set<TeamWalletTransactionType>([
  'CONTRIBUTION_CREDIT',
  'CONTRIBUTION_REFUND_DEBIT',
  'CLOSURE_REFUND_DEBIT',
]);

type LedgerInput = {
  teamId: string;
  amountCents: number;
  idempotencyKey: string;
  actorUserId?: string | null;
  contributorUserId?: string | null;
  linkedWalletTransactionId?: string | null;
  referenceType?: string;
  referenceId?: string;
  description?: string;
};

type DebitInput = LedgerInput & {
  type: Exclude<TeamWalletTransactionType, 'CONTRIBUTION_CREDIT'>;
  /** Spend only this member's own contributions (self-refund and closure refund). */
  spendContributionsOf?: string;
};

const assertReplay = (
  row: { teamWalletAccountId: string; amountCents: number; type: TeamWalletTransactionType },
  accountId: string,
  signedAmount: number,
  type: TeamWalletTransactionType,
) => {
  if (row.teamWalletAccountId !== accountId || row.amountCents !== signedAmount || row.type !== type)
    throw new AppError(409, 'That financial idempotency key was already used.', 'FINANCIAL_IDEMPOTENCY_CONFLICT');
};

const assertPositiveWholeCents = (amountCents: number, label: string) => {
  if (!Number.isInteger(amountCents) || amountCents <= 0)
    throw new AppError(400, `${label} must be a positive amount.`, 'FINANCIAL_AMOUNT_INVALID');
};

export type UnspentContribution = {
  transactionId: string;
  contributorUserId: string;
  amountCents: number;
  unspentCents: number;
  createdAt: Date;
};

export class TeamWalletRepository {
  /** Creates the team's wallet on first use (every team starts at zero) and locks it. */
  async lockAccount(tx: Prisma.TransactionClient, teamId: string) {
    await tx.$executeRaw`
      INSERT INTO "TeamWalletAccount" ("teamId", "updatedAt") VALUES (${teamId}::uuid, CURRENT_TIMESTAMP)
      ON CONFLICT ("teamId") DO NOTHING
    `;
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "TeamWalletAccount" WHERE "teamId" = ${teamId}::uuid FOR UPDATE
    `;
    return tx.teamWalletAccount.findUniqueOrThrow({ where: { id: rows[0].id } });
  }

  /** Locks several team wallets in a deterministic order so two sides never deadlock. */
  async lockAccounts(tx: Prisma.TransactionClient, teamIds: string[]) {
    const unique = [...new Set(teamIds)].sort();
    const accounts = [];
    for (const teamId of unique) accounts.push(await this.lockAccount(tx, teamId));
    return accounts;
  }

  async heldCents(tx: Prisma.TransactionClient, teamWalletAccountId: string) {
    const held = await tx.teamWalletHold.aggregate({
      where: { teamWalletAccountId, status: 'ACTIVE' },
      _sum: { amountCents: true },
    });
    return held._sum.amountCents ?? 0;
  }

  /** Read-only balance view (no lock). A team without a wallet yet has zero. */
  async summary(tx: Prisma.TransactionClient, teamId: string) {
    const account = await tx.teamWalletAccount.findUnique({ where: { teamId } });
    if (!account) return { accountId: null, balanceCents: 0, heldCents: 0, availableCents: 0 };
    const heldCents = await this.heldCents(tx, account.id);
    return {
      accountId: account.id,
      balanceCents: account.balanceCents,
      heldCents,
      availableCents: account.balanceCents - heldCents,
    };
  }

  /** A member's contribution arriving from their personal wallet (the personal debit is linked). */
  async credit(tx: Prisma.TransactionClient, input: LedgerInput) {
    assertPositiveWholeCents(input.amountCents, 'Credit');
    if (!input.contributorUserId || !input.linkedWalletTransactionId)
      throw new AppError(500, 'A team contribution must name its member and personal ledger row.', 'FINANCIAL_INTEGRITY_ERROR');
    const account = await this.lockAccount(tx, input.teamId);
    const replay = await tx.teamWalletTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (replay) {
      assertReplay(replay, account.id, input.amountCents, 'CONTRIBUTION_CREDIT');
      return { account, transaction: replay, replayed: true };
    }
    const transaction = await tx.teamWalletTransaction.create({
      data: {
        teamWalletAccountId: account.id,
        type: 'CONTRIBUTION_CREDIT',
        amountCents: input.amountCents,
        idempotencyKey: input.idempotencyKey,
        actorUserId: input.actorUserId ?? input.contributorUserId,
        contributorUserId: input.contributorUserId,
        linkedWalletTransactionId: input.linkedWalletTransactionId,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        description: input.description,
      },
    });
    const updated = await tx.teamWalletAccount.update({
      where: { id: account.id },
      data: { balanceCents: { increment: input.amountCents } },
    });
    return { account: updated, transaction, replayed: false };
  }

  /**
   * Spends available (unheld) team money: a member's refund of their own unspent contributions,
   * or a closure refund. Allocated to the contributions it spends.
   */
  async debit(tx: Prisma.TransactionClient, input: DebitInput) {
    assertPositiveWholeCents(input.amountCents, 'Debit');
    if (PERSONAL_LINKED_TYPES.has(input.type) && (!input.contributorUserId || !input.linkedWalletTransactionId))
      throw new AppError(500, 'A team refund must name its member and personal ledger row.', 'FINANCIAL_INTEGRITY_ERROR');
    const account = await this.lockAccount(tx, input.teamId);
    const signedAmount = -input.amountCents;
    const replay = await tx.teamWalletTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (replay) {
      assertReplay(replay, account.id, signedAmount, input.type);
      return { account, transaction: replay, replayed: true };
    }
    const held = await this.heldCents(tx, account.id);
    if (account.balanceCents - held < input.amountCents) throw new TeamWalletInsufficientFundsError();
    const transaction = await tx.teamWalletTransaction.create({
      data: {
        teamWalletAccountId: account.id,
        type: input.type,
        amountCents: signedAmount,
        idempotencyKey: input.idempotencyKey,
        actorUserId: input.actorUserId,
        contributorUserId: input.contributorUserId,
        linkedWalletTransactionId: input.linkedWalletTransactionId,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        description: input.description,
      },
    });
    await this.allocate(tx, account.id, transaction.id, input.amountCents, input.spendContributionsOf);
    const updated = await tx.teamWalletAccount.update({
      where: { id: account.id },
      data: { balanceCents: { decrement: input.amountCents } },
    });
    return { account: updated, transaction, replayed: false };
  }

  /** Fill-meter money: reduces the available balance until it is captured or released. */
  async createHold(
    tx: Prisma.TransactionClient,
    input: { teamId: string; matchId: string; side: TeamSide; amountCents: number; idempotencyKey: string; createdByUserId: string },
  ) {
    assertPositiveWholeCents(input.amountCents, 'Hold');
    const account = await this.lockAccount(tx, input.teamId);
    const replay = await tx.teamWalletHold.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (replay) {
      if (replay.teamWalletAccountId !== account.id || replay.amountCents !== input.amountCents
        || replay.matchId !== input.matchId || replay.side !== input.side)
        throw new AppError(409, 'That hold idempotency key was already used.', 'FINANCIAL_IDEMPOTENCY_CONFLICT');
      return { hold: replay, replayed: true };
    }
    const held = await this.heldCents(tx, account.id);
    if (account.balanceCents - held < input.amountCents) throw new TeamWalletInsufficientFundsError();
    const hold = await tx.teamWalletHold.create({
      data: {
        teamWalletAccountId: account.id,
        matchId: input.matchId,
        side: input.side,
        amountCents: input.amountCents,
        idempotencyKey: input.idempotencyKey,
        createdByUserId: input.createdByUserId,
      },
    });
    return { hold, replayed: false };
  }

  /** Captures a hold once (the match went ahead). Replays return the original ledger row. */
  async captureHold(tx: Prisma.TransactionClient, holdId: string, ledger: { idempotencyKey: string; description?: string }) {
    const found = await tx.teamWalletHold.findUnique({ where: { id: holdId }, include: { account: true } });
    if (!found) throw new AppError(404, 'Team wallet hold not found.', 'TEAM_WALLET_HOLD_NOT_FOUND');
    const account = await this.lockAccount(tx, found.account.teamId);
    const current = await tx.teamWalletHold.findUniqueOrThrow({ where: { id: holdId } });
    if (current.status === 'CAPTURED') {
      const transaction = await tx.teamWalletTransaction.findUnique({ where: { id: current.captureTransactionId! } });
      if (!transaction || transaction.idempotencyKey !== ledger.idempotencyKey)
        throw new AppError(409, 'Captured team hold ledger is missing.', 'FINANCIAL_INTEGRITY_ERROR');
      return { hold: current, transaction, replayed: true };
    }
    if (current.status !== 'ACTIVE') throw new AppError(409, 'Team wallet hold is no longer active.', 'TEAM_WALLET_HOLD_INACTIVE');
    if (account.balanceCents < current.amountCents)
      throw new AppError(409, 'Team wallet balance is below an active hold.', 'FINANCIAL_INTEGRITY_ERROR');
    const transaction = await tx.teamWalletTransaction.create({
      data: {
        teamWalletAccountId: account.id,
        type: 'TEAM_MATCH_FEE_DEBIT',
        amountCents: -current.amountCents,
        idempotencyKey: ledger.idempotencyKey,
        referenceType: 'MATCH',
        referenceId: current.matchId,
        description: ledger.description,
      },
    });
    await this.allocate(tx, account.id, transaction.id, current.amountCents);
    await tx.teamWalletAccount.update({
      where: { id: account.id },
      data: { balanceCents: { decrement: current.amountCents } },
    });
    const hold = await tx.teamWalletHold.update({
      where: { id: holdId },
      data: { status: 'CAPTURED', capturedAt: new Date(), captureTransactionId: transaction.id },
    });
    return { hold, transaction, replayed: false };
  }

  /** Releases a hold back to the available balance. Replays are harmless; captured holds refuse. */
  async releaseHold(tx: Prisma.TransactionClient, holdId: string, reason: string) {
    const found = await tx.teamWalletHold.findUnique({ where: { id: holdId }, include: { account: true } });
    if (!found) throw new AppError(404, 'Team wallet hold not found.', 'TEAM_WALLET_HOLD_NOT_FOUND');
    await this.lockAccount(tx, found.account.teamId);
    const current = await tx.teamWalletHold.findUniqueOrThrow({ where: { id: holdId } });
    if (current.status === 'RELEASED') return { hold: current, replayed: true };
    if (current.status === 'CAPTURED')
      throw new AppError(409, 'A captured team hold cannot be released.', 'TEAM_WALLET_HOLD_CAPTURED');
    return {
      hold: await tx.teamWalletHold.update({
        where: { id: holdId },
        data: { status: 'RELEASED', releasedAt: new Date(), releaseReason: reason },
      }),
      replayed: false,
    };
  }

  /** Unspent contributions of a team wallet, oldest first (optionally only one member's). */
  async unspentContributions(tx: Prisma.TransactionClient, teamWalletAccountId: string, contributorUserId?: string) {
    const contributions = await tx.teamWalletTransaction.findMany({
      where: { teamWalletAccountId, type: 'CONTRIBUTION_CREDIT', ...(contributorUserId && { contributorUserId }) },
      select: { id: true, contributorUserId: true, amountCents: true, createdAt: true, spentBy: { select: { amountCents: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return contributions
      .map((row): UnspentContribution => ({
        transactionId: row.id,
        contributorUserId: row.contributorUserId!,
        amountCents: row.amountCents,
        unspentCents: row.amountCents - row.spentBy.reduce((sum, spend) => sum + spend.amountCents, 0),
        createdAt: row.createdAt,
      }))
      .filter((row) => row.unspentCents > 0);
  }

  /** Each member's total unspent contributions (for self-refund and closure). */
  async unspentByContributor(tx: Prisma.TransactionClient, teamWalletAccountId: string) {
    const totals = new Map<string, number>();
    for (const row of await this.unspentContributions(tx, teamWalletAccountId))
      totals.set(row.contributorUserId, (totals.get(row.contributorUserId) ?? 0) + row.unspentCents);
    return totals;
  }

  /** D8: a debit spends contributions oldest first (only one member's own for their refunds). */
  private async allocate(
    tx: Prisma.TransactionClient,
    teamWalletAccountId: string,
    debitTransactionId: string,
    amountCents: number,
    contributorUserId?: string,
  ) {
    let remaining = amountCents;
    for (const contribution of await this.unspentContributions(tx, teamWalletAccountId, contributorUserId)) {
      if (!remaining) break;
      const spend = Math.min(remaining, contribution.unspentCents);
      await tx.teamWalletAllocation.create({
        data: { contributionTransactionId: contribution.transactionId, debitTransactionId, amountCents: spend },
      });
      remaining -= spend;
    }
    if (remaining)
      throw contributorUserId
        ? new TeamWalletInsufficientFundsError('That is more than your unspent contributions to this team.')
        : new AppError(409, 'Team wallet contributions do not cover this debit.', 'FINANCIAL_INTEGRITY_ERROR');
  }
}
