import {
  TEAM_CONTRIBUTION_DAILY_MAX_CENTS,
  TEAM_CONTRIBUTION_DAILY_MAX_COUNT,
  type ReclaimableTeamContribution,
  type TeamContributionResult,
  type TeamWalletEntry,
  type TeamWalletEntryKind,
  type TeamWalletHoldView,
  type TeamWalletPage,
  type TeamWalletSummary,
} from '@footy-finder/shared';
import type { Prisma, TeamWalletTransactionType } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { emitDomainEventBestEffort } from '../../events/domain-events.js';
import { FinancialInsufficientFundsError, FinancialRepository } from '../wallet/financial.repository.js';
import { formatRands } from '../matches/cancellation-message.js';
import { TeamWalletRepository } from './team-wallet.repository.js';
import { TeamWalletTransfers } from './team-wallet.transfers.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** The retired team wallet history route's query (DEC-021); kept until the team wallet code is removed with A10. */
type TeamWalletHistoryQuery = { cursor?: string; limit: number };

const KIND_BY_TYPE: Record<TeamWalletTransactionType, TeamWalletEntryKind> = {
  CONTRIBUTION_CREDIT: 'CONTRIBUTION',
  CONTRIBUTION_REFUND_DEBIT: 'CONTRIBUTION_REFUND',
  CLOSURE_REFUND_DEBIT: 'CLOSURE_REFUND',
  TEAM_MATCH_FEE_DEBIT: 'TEAM_MATCH_FEE',
};
const TITLE_BY_KIND: Record<TeamWalletEntryKind, string> = {
  CONTRIBUTION: 'Contribution',
  CONTRIBUTION_REFUND: 'Contribution returned to member',
  CLOSURE_REFUND: 'Returned when the team closed',
  TEAM_MATCH_FEE: 'Team match fee',
};

const encodeCursor = (createdAt: Date, id: string) =>
  Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
const decodeCursor = (cursor: string) => {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(iso ?? '');
  if (!id || !/^[0-9a-f-]{36}$/i.test(id) || Number.isNaN(createdAt.getTime()))
    throw new AppError(400, 'That history cursor is not valid.', 'TEAM_WALLET_CURSOR_INVALID');
  return { createdAt, id };
};
const assertIdempotencyKey = (key: string) => {
  if (!key || key.length > 200)
    throw new AppError(400, 'A valid Idempotency-Key header is required.', 'IDEMPOTENCY_KEY_REQUIRED');
};

const entrySelect = {
  id: true,
  type: true,
  amountCents: true,
  createdAt: true,
  contributorUserId: true,
  referenceType: true,
  referenceId: true,
  contributor: { select: { username: true, profile: { select: { displayName: true } } } },
} as const;
type EntryRow = Prisma.TeamWalletTransactionGetPayload<{ select: typeof entrySelect }>;

/**
 * Gate 7 / TKT-702 (DEC-014, D4, D8): contributions from a member's personal wallet and a
 * member's refund of their own unspent contributions. Both legs of a transfer commit together.
 */
export class TeamWalletService {
  constructor(
    private readonly teamWallets = new TeamWalletRepository(),
    private readonly financial = new FinancialRepository(),
    private readonly transfers = new TeamWalletTransfers(teamWallets, financial),
  ) {}

  /** D4: any current member, R10-R5,000, within the rolling 24-hour limits. */
  async contribute(teamId: string, userId: string, amountCents: number, idempotencyKey: string): Promise<TeamContributionResult> {
    assertIdempotencyKey(idempotencyKey);
    const key = `team-contribution:${teamId}:${userId}:${idempotencyKey}`;
    try {
      const result = await serializableTransaction(async (tx) => {
        await this.lockTeamShared(tx, teamId);
        const team = await this.currentTeam(tx, teamId);
        await this.assertMember(tx, teamId, userId);
        const replay = await tx.teamWalletTransaction.findUnique({ where: { idempotencyKey: key }, select: entrySelect });
        if (!replay) {
          const account = await this.teamWallets.lockAccount(tx, teamId);
          const recent = await tx.teamWalletTransaction.aggregate({
            where: {
              teamWalletAccountId: account.id,
              type: 'CONTRIBUTION_CREDIT',
              contributorUserId: userId,
              createdAt: { gte: new Date(Date.now() - DAY_MS) },
            },
            _sum: { amountCents: true },
            _count: true,
          });
          if (recent._count >= TEAM_CONTRIBUTION_DAILY_MAX_COUNT)
            throw new AppError(429, `You can contribute to a team at most ${TEAM_CONTRIBUTION_DAILY_MAX_COUNT} times in 24 hours.`, 'TEAM_CONTRIBUTION_DAILY_LIMIT');
          if ((recent._sum.amountCents ?? 0) + amountCents > TEAM_CONTRIBUTION_DAILY_MAX_CENTS)
            throw new AppError(429, `You can contribute at most ${formatRands(TEAM_CONTRIBUTION_DAILY_MAX_CENTS)} to a team in 24 hours.`, 'TEAM_CONTRIBUTION_DAILY_LIMIT');
        }
        const description = `Contribution to ${team.name}`;
        const personal = await this.financial.debit(tx, {
          userId, amountCents, type: 'TEAM_CONTRIBUTION_DEBIT', idempotencyKey: `${key}:personal`,
          referenceType: 'TEAM', referenceId: teamId, description,
        });
        const credited = await this.teamWallets.credit(tx, {
          teamId, amountCents, idempotencyKey: key, actorUserId: userId, contributorUserId: userId,
          linkedWalletTransactionId: personal.transaction.id, referenceType: 'TEAM', referenceId: teamId, description,
        });
        const row = await tx.teamWalletTransaction.findUniqueOrThrow({ where: { id: credited.transaction.id }, select: entrySelect });
        return { row, replayed: credited.replayed, wallet: await this.summaryInTx(tx, teamId, userId) };
      });
      if (!result.replayed) this.publish(teamId, userId);
      return { wallet: result.wallet, entry: (await this.toEntries([result.row]))[0]!, replayed: result.replayed };
    } catch (error) {
      if (error instanceof FinancialInsufficientFundsError)
        throw new AppError(402, 'Your wallet does not have enough available money for this contribution. Top up your wallet first.', 'INSUFFICIENT_BALANCE');
      throw error;
    }
  }

  /** D8: a contributor (current or former member) takes back some of their own unspent money. */
  async refund(teamId: string, userId: string, amountCents: number, idempotencyKey: string) {
    assertIdempotencyKey(idempotencyKey);
    const result = await serializableTransaction(async (tx) => {
      await this.lockTeamShared(tx, teamId);
      const team = await tx.team.findUnique({ where: { id: teamId }, select: { name: true } });
      if (!team) throw new AppError(404, 'Team not found.', 'TEAM_NOT_FOUND');
      const refunded = await this.transfers.refundContributor(tx, {
        teamId, teamName: team.name, contributorUserId: userId, amountCents,
        type: 'CONTRIBUTION_REFUND_DEBIT', idempotencyKey: `team-refund:${teamId}:${userId}:${idempotencyKey}`, actorUserId: userId,
      });
      return { replayed: refunded.replayed, wallet: await this.summaryInTx(tx, teamId, userId) };
    });
    if (!result.replayed) this.publish(teamId, userId);
    return result;
  }

  async summary(teamId: string, userId: string): Promise<TeamWalletSummary> {
    return serializableTransaction(async (tx) => {
      await this.assertMember(tx, teamId, userId);
      return this.summaryInTx(tx, teamId, userId);
    });
  }

  async history(teamId: string, userId: string, query: TeamWalletHistoryQuery): Promise<TeamWalletPage> {
    await serializableTransaction((tx) => this.assertMember(tx, teamId, userId));
    const account = await prisma.teamWalletAccount.findUnique({ where: { teamId } });
    if (!account) return { entries: [], nextCursor: null };
    const after = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await prisma.teamWalletTransaction.findMany({
      where: {
        teamWalletAccountId: account.id,
        ...(after && { OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: entrySelect,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      entries: await this.toEntries(page),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  /** Only the owner and current captains see actionable fill-meter holds (DEC-014). */
  async holds(teamId: string, userId: string): Promise<TeamWalletHoldView[]> {
    const role = await serializableTransaction((tx) => this.assertMember(tx, teamId, userId));
    if (role !== 'OWNER' && role !== 'CAPTAIN')
      throw new AppError(403, 'Owner or captain permission is required.', 'TEAM_FORBIDDEN');
    const holds = await prisma.teamWalletHold.findMany({
      where: { account: { teamId }, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, side: true, amountCents: true, createdAt: true, match: { select: { id: true, name: true, startsAt: true } } },
    });
    return holds.map((hold) => ({
      id: hold.id,
      match: { id: hold.match.id, name: hold.match.name, startsAt: hold.match.startsAt.toISOString() },
      side: hold.side,
      amountCents: hold.amountCents,
      createdAt: hold.createdAt.toISOString(),
    }));
  }

  /** Teams where the caller still has unspent contributions, including teams they have left. */
  async reclaimable(userId: string): Promise<ReclaimableTeamContribution[]> {
    const accounts = await prisma.teamWalletAccount.findMany({
      where: { transactions: { some: { contributorUserId: userId, type: 'CONTRIBUTION_CREDIT' } } },
      select: { id: true, team: { select: { id: true, name: true, archivedAt: true } } },
    });
    const result: ReclaimableTeamContribution[] = [];
    for (const account of accounts) {
      const { unspent, available } = await serializableTransaction(async (tx) => ({
        unspent: (await this.teamWallets.unspentByContributor(tx, account.id)).get(userId) ?? 0,
        available: (await this.teamWallets.summary(tx, account.team.id)).availableCents,
      }));
      if (unspent > 0)
        result.push({
          team: { id: account.team.id, name: account.team.name, archived: Boolean(account.team.archivedAt) },
          unspentCents: unspent,
          refundableCents: Math.min(unspent, available),
        });
    }
    return result;
  }

  private async summaryInTx(tx: Prisma.TransactionClient, teamId: string, userId: string): Promise<TeamWalletSummary> {
    const [wallet, membership, team] = await Promise.all([
      this.teamWallets.summary(tx, teamId),
      tx.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId } }, select: { role: true } }),
      tx.team.findUnique({ where: { id: teamId }, select: { archivedAt: true } }),
    ]);
    const viewerUnspentCents = wallet.accountId
      ? (await this.teamWallets.unspentByContributor(tx, wallet.accountId)).get(userId) ?? 0
      : 0;
    const active = Boolean(membership) && !team?.archivedAt;
    return {
      teamId,
      balanceCents: wallet.balanceCents,
      heldCents: wallet.heldCents,
      availableCents: wallet.availableCents,
      currency: 'ZAR',
      viewerUnspentCents,
      viewerRefundableCents: Math.min(viewerUnspentCents, wallet.availableCents),
      viewerCanManage: active && (membership?.role === 'OWNER' || membership?.role === 'CAPTAIN'),
      viewerCanContribute: active,
    };
  }

  private async toEntries(rows: EntryRow[]): Promise<TeamWalletEntry[]> {
    const matchIds = [...new Set(rows.flatMap((row) => (row.referenceType === 'MATCH' && row.referenceId ? [row.referenceId] : [])))];
    const matches = matchIds.length
      ? await prisma.match.findMany({ where: { id: { in: matchIds } }, select: { id: true, name: true } })
      : [];
    const matchById = new Map(matches.map((match) => [match.id, match]));
    return rows.map((row) => {
      const kind = KIND_BY_TYPE[row.type];
      const match = row.referenceType === 'MATCH' && row.referenceId ? matchById.get(row.referenceId) : undefined;
      return {
        id: row.id,
        kind,
        amountCents: row.amountCents,
        currency: 'ZAR',
        title: TITLE_BY_KIND[kind],
        createdAt: row.createdAt.toISOString(),
        ...(row.contributorUserId && row.contributor && {
          contributor: { userId: row.contributorUserId, displayName: row.contributor.profile?.displayName ?? row.contributor.username },
        }),
        ...(match && { related: { type: 'match' as const, id: match.id, name: match.name } }),
      };
    });
  }

  /** Serialises with team closure (which takes the Team row FOR UPDATE). */
  private async lockTeamShared(tx: Prisma.TransactionClient, teamId: string) {
    await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id" = ${teamId}::uuid FOR SHARE`;
  }

  private async currentTeam(tx: Prisma.TransactionClient, teamId: string) {
    const team = await tx.team.findUnique({ where: { id: teamId }, select: { name: true, archivedAt: true } });
    if (!team) throw new AppError(404, 'Team not found.', 'TEAM_NOT_FOUND');
    if (team.archivedAt) throw new AppError(409, 'This team has been closed.', 'TEAM_ARCHIVED');
    return team;
  }

  private async assertMember(tx: Prisma.TransactionClient, teamId: string, userId: string) {
    const membership = await tx.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId } }, select: { role: true } });
    if (!membership) throw new AppError(403, 'Current Team membership is required.', 'TEAM_FORBIDDEN');
    return membership.role;
  }

  private publish(teamId: string, userId: string) {
    emitDomainEventBestEffort('team:wallet-updated', { teamId });
    emitDomainEventBestEffort('wallet:updated', { userId });
  }
}
