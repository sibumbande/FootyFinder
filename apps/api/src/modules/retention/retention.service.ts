import type { RetentionCategorySummary, RetentionOverview } from '@footy-finder/shared';
import { prisma } from '../../database/prisma.js';
import { AppError } from '../../errors/app-error.js';
import type { Prisma, RetentionMode } from '../../generated/prisma/client.js';
import { logError, logInfo } from '../../observability/logger.js';
import { appendAdminAudit } from '../admin/admin-audit.js';
import {
  REPORT_ONLY_CATEGORIES,
  RETENTION_CATEGORIES,
  RETENTION_RULES,
  auditRetentionCutoff,
  financialRetentionCutoff,
  threeYearsBefore,
  twelveMonthsBefore,
  type RetentionCategory,
} from './retention.policy.js';

type Db = Prisma.TransactionClient;
const OPEN_REPORT = ['OPEN', 'UNDER_REVIEW'] as const;

/** What one category would purge: counts per kind and the purge itself (run only in APPLY mode). */
type CategoryPlan = {
  cutoffs: Record<string, string>;
  counts: Record<string, number>;
  /** Kinds counted for an admin to review only; never purged. */
  reviewOnly?: string[];
  purge: (db: Db) => Promise<number>;
};

async function messagesPlan(db: Db, now: Date): Promise<CategoryPlan> {
  const cutoff = twelveMonthsBefore(now);
  // "Under investigation": an open report on a message keeps its whole conversation, Lobby or Team chat.
  const reports = await db.moderationReport.findMany({
    where: { status: { in: [...OPEN_REPORT] }, targetType: { in: ['DIRECT_MESSAGE', 'LOBBY_MESSAGE', 'TEAM', 'MATCH'] } },
    select: { targetType: true, targetId: true },
  });
  const ids = (type: string) => reports.filter(({ targetType }) => targetType === type).map(({ targetId }) => targetId);
  const heldConversations = (await db.directMessage.findMany({ where: { id: { in: ids('DIRECT_MESSAGE') } }, select: { conversationId: true } })).map(({ conversationId }) => conversationId);
  const heldMatches = [
    ...ids('MATCH'),
    ...(await db.lobbyMessage.findMany({ where: { id: { in: ids('LOBBY_MESSAGE') } }, select: { matchId: true } })).map(({ matchId }) => matchId),
  ];
  const heldTeams = ids('TEAM');
  const dm = { createdAt: { lt: cutoff }, conversationId: { notIn: heldConversations } } satisfies Prisma.DirectMessageWhereInput;
  const lobby = { createdAt: { lt: cutoff }, matchId: { notIn: heldMatches } } satisfies Prisma.LobbyMessageWhereInput;
  const team = { createdAt: { lt: cutoff }, teamId: { notIn: heldTeams } } satisfies Prisma.TeamMessageWhereInput;
  const support = {
    status: { in: ['RESOLVED', 'CLOSED'] },
    OR: [{ closedAt: { lt: cutoff } }, { closedAt: null, resolvedAt: { lt: cutoff } }],
  } satisfies Prisma.SupportTicketWhereInput;
  return {
    cutoffs: { olderThan: cutoff.toISOString() },
    counts: {
      directMessages: await db.directMessage.count({ where: dm }),
      lobbyMessages: await db.lobbyMessage.count({ where: lobby }),
      teamMessages: await db.teamMessage.count({ where: team }),
      supportRequests: await db.supportTicket.count({ where: support }),
    },
    purge: async (tx) =>
      (await tx.directMessage.deleteMany({ where: dm })).count
      + (await tx.lobbyMessage.deleteMany({ where: lobby })).count
      + (await tx.teamMessage.deleteMany({ where: team })).count
      + (await tx.supportTicket.deleteMany({ where: support })).count,
  };
}

async function endedSocialPlan(db: Db, now: Date): Promise<CategoryPlan> {
  const cutoff = twelveMonthsBefore(now);
  // An unanswered request "ends" when it expires.
  const friendRequests = {
    OR: [{ status: { not: 'PENDING' }, respondedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }],
  } satisfies Prisma.FriendRequestWhereInput;
  const invites = {
    OR: [{ status: { not: 'PENDING' }, respondedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }],
  } satisfies Prisma.TeamMemberInviteWhereInput;
  const joinRequests = {
    OR: [{ status: { not: 'PENDING' }, respondedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }],
  } satisfies Prisma.TeamJoinRequestWhereInput;
  const posts = {
    OR: [{ closedAt: { lt: cutoff } }, { removedAt: { lt: cutoff } }, { status: 'OPEN', expiresAt: { lt: cutoff } }],
  } satisfies Prisma.TeamRecruitmentPostWhereInput;
  const cards = { enabled: false, updatedAt: { lt: cutoff } } satisfies Prisma.PlayerLookingCardWhereInput;
  return {
    cutoffs: { endedBefore: cutoff.toISOString() },
    counts: {
      friendRequests: await db.friendRequest.count({ where: friendRequests }),
      teamInvites: await db.teamMemberInvite.count({ where: invites }),
      joinRequests: await db.teamJoinRequest.count({ where: joinRequests }),
      recruitmentPosts: await db.teamRecruitmentPost.count({ where: posts }),
      lookingCards: await db.playerLookingCard.count({ where: cards }),
    },
    purge: async (tx) =>
      (await tx.friendRequest.deleteMany({ where: friendRequests })).count
      + (await tx.teamMemberInvite.deleteMany({ where: invites })).count
      + (await tx.teamJoinRequest.deleteMany({ where: joinRequests })).count
      + (await tx.teamRecruitmentPost.deleteMany({ where: posts })).count
      + (await tx.playerLookingCard.deleteMany({ where: cards })).count,
  };
}

async function closedAccountsPlan(db: Db, now: Date): Promise<CategoryPlan> {
  const cutoff = twelveMonthsBefore(now);
  const records = {
    OR: [
      { status: 'COMPLETED', completedAt: { lt: cutoff }, contactEmail: null },
      { status: 'CANCELLED', cancelledAt: { lt: cutoff } },
      { status: 'BLOCKED', updatedAt: { lt: cutoff } },
    ],
  } satisfies Prisma.AccountDeletionRequestWhereInput;
  const leftoverNotifications = { user: { accountStatus: 'DELETED' } } satisfies Prisma.NotificationWhereInput;
  const banned = await db.accountEnforcement.count({ where: { type: 'BAN', status: 'ACTIVE', createdAt: { lt: cutoff }, user: { accountStatus: 'BANNED' } } });
  return {
    cutoffs: { closedBefore: cutoff.toISOString() },
    counts: {
      deletionRecords: await db.accountDeletionRequest.count({ where: records }),
      notificationsOnDeletedAccounts: await db.notification.count({ where: leftoverNotifications }),
      bannedAccountsToReview: banned,
    },
    reviewOnly: ['bannedAccountsToReview'],
    purge: async (tx) =>
      (await tx.accountDeletionRequest.deleteMany({ where: records })).count
      + (await tx.notification.deleteMany({ where: leftoverNotifications })).count,
  };
}

async function waitingListPlan(db: Db): Promise<CategoryPlan> {
  const unsubscribed = { unsubscribedAt: { not: null }, deletedAt: null } satisfies Prisma.CityInterestWhereInput;
  return {
    cutoffs: {},
    counts: { unsubscribedEntries: await db.cityInterest.count({ where: unsubscribed }) },
    purge: async (tx) => {
      const rows = await tx.cityInterest.findMany({ where: unsubscribed, select: { id: true } });
      const now = new Date();
      for (const { id } of rows)
        await tx.cityInterest.update({
          where: { id },
          data: { deletedAt: now, email: `deleted-${id}@deleted.invalid`, dedupeKey: `deleted:${id}`, userId: null },
        });
      return rows.length;
    },
  };
}

async function conductPlan(db: Db, now: Date): Promise<CategoryPlan> {
  const cutoff = threeYearsBefore(now);
  const reports = { status: { in: ['RESOLVED', 'DISMISSED'] }, resolvedAt: { lt: cutoff } } satisfies Prisma.ModerationReportWhereInput;
  const enforcements = {
    status: { in: ['EXPIRED', 'REVOKED'] },
    OR: [{ revokedAt: { lt: cutoff } }, { revokedAt: null, endsAt: { lt: cutoff } }],
  } satisfies Prisma.AccountEnforcementWhereInput;
  const disputes = { status: { in: ['RESOLVED', 'REJECTED'] }, resolvedAt: { lt: cutoff } } satisfies Prisma.DisputeWhereInput;
  return {
    cutoffs: { resolvedBefore: cutoff.toISOString() },
    counts: {
      reports: await db.moderationReport.count({ where: reports }),
      enforcements: await db.accountEnforcement.count({ where: enforcements }),
      disputes: await db.dispute.count({ where: disputes }),
    },
    purge: async (tx) =>
      (await tx.moderationReport.deleteMany({ where: reports })).count
      + (await tx.accountEnforcement.deleteMany({ where: enforcements })).count
      + (await tx.dispute.deleteMany({ where: disputes })).count,
  };
}

async function financialPlan(db: Db, now: Date): Promise<CategoryPlan> {
  const cutoff = financialRetentionCutoff(now);
  return {
    cutoffs: { createdBefore: cutoff.toISOString() },
    counts: {
      walletLedgerRows: await db.walletTransaction.count({ where: { createdAt: { lt: cutoff } } }),
      teamWalletLedgerRows: await db.teamWalletTransaction.count({ where: { createdAt: { lt: cutoff } } }),
      payments: await db.providerPayment.count({ where: { createdAt: { lt: cutoff } } }),
      refunds: await db.providerRefund.count({ where: { createdAt: { lt: cutoff } } }),
    },
    reviewOnly: ['walletLedgerRows', 'teamWalletLedgerRows', 'payments', 'refunds'],
    purge: async () => 0,
  };
}

/**
 * Batch 5 brief, B4 (CEO D18): admin audit entries older than 5 years, except entries linked to a case that is still
 * open: a payment dispute, a refund not yet settled, an unsettled account deletion, an open booking/result dispute or
 * an open report. The purge sets a transaction-local flag; the AdminAuditLog trigger still refuses any row younger
 * than 5 years and every UPDATE.
 */
async function auditPlan(db: Db, now: Date): Promise<CategoryPlan> {
  const cutoff = auditRetentionCutoff(now);
  const openRefunds = await db.providerRefund.findMany({
    where: { OR: [{ status: { in: ['PENDING', 'PROCESSING', 'NEEDS_ATTENTION', 'FAILED'] } }, { reviewReason: { not: null } }] },
    select: { id: true, providerPaymentId: true },
  });
  const openPaymentDisputes = await db.providerDispute.findMany({
    where: { status: 'OPEN' },
    select: { id: true, providerPaymentId: true, providerPayment: { select: { userId: true } } },
  });
  const openDeletions = await db.accountDeletionRequest.findMany({
    where: { OR: [{ status: { in: ['GRACE', 'WAITING'] } }, { status: 'COMPLETED', contactEmail: { not: null } }] },
    select: { id: true, userId: true },
  });
  const openDisputes = await db.dispute.findMany({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } }, select: { id: true } });
  const openReports = await db.moderationReport.findMany({ where: { status: { in: [...OPEN_REPORT] } }, select: { id: true } });
  const disputedUsers = openPaymentDisputes.map(({ providerPayment }) => providerPayment.userId);
  const held: Array<{ entityType: string; ids: string[] }> = [
    { entityType: 'ProviderRefund', ids: openRefunds.map(({ id }) => id) },
    { entityType: 'ProviderPayment', ids: [...openRefunds, ...openPaymentDisputes].map(({ providerPaymentId }) => providerPaymentId) },
    { entityType: 'ProviderDispute', ids: openPaymentDisputes.map(({ id }) => id) },
    { entityType: 'WalletAccount', ids: disputedUsers },
    { entityType: 'USER', ids: [...disputedUsers, ...openDeletions.map(({ userId }) => userId)] },
    { entityType: 'AccountDeletionRequest', ids: openDeletions.map(({ id }) => id) },
    { entityType: 'DISPUTE', ids: openDisputes.map(({ id }) => id) },
    { entityType: 'MODERATION_REPORT', ids: openReports.map(({ id }) => id) },
  ].filter(({ ids }) => ids.length > 0);
  const where = {
    createdAt: { lt: cutoff },
    NOT: held.map(({ entityType, ids }) => ({ entityType, entityId: { in: ids } })),
  } satisfies Prisma.AdminAuditLogWhereInput;
  return {
    cutoffs: { olderThan: cutoff.toISOString() },
    counts: { auditEntries: await db.adminAuditLog.count({ where }) },
    purge: async (tx) => {
      await tx.$queryRaw`SELECT set_config('footy.audit_purge', 'on', true)`;
      return (await tx.adminAuditLog.deleteMany({ where })).count;
    },
  };
}

const plans: Record<RetentionCategory, (db: Db, now: Date) => Promise<CategoryPlan>> = {
  MESSAGES: messagesPlan,
  ENDED_SOCIAL: endedSocialPlan,
  CLOSED_ACCOUNTS: closedAccountsPlan,
  WAITING_LIST: (db) => waitingListPlan(db),
  CONDUCT: conductPlan,
  FINANCIAL: financialPlan,
  AUDIT: auditPlan,
};

export class RetentionService {
  async modes(): Promise<Record<RetentionCategory, RetentionMode>> {
    const rows = await prisma.retentionPolicySetting.findMany();
    return Object.fromEntries(
      RETENTION_CATEGORIES.map((category) => [category, rows.find((row) => row.category === category)?.mode ?? 'REPORT']),
    ) as Record<RetentionCategory, RetentionMode>;
  }

  /**
   * One run over every category. The daily job uses each category's mode; "Report now" (an admin) is always a
   * dry run. Each category is its own transaction and its own audited RetentionRun row.
   */
  async run(input: { trigger: 'DAILY' | 'ADMIN_REPORT'; actorUserId?: string; now?: Date }) {
    const now = input.now ?? new Date();
    const modes = await this.modes();
    const results = [];
    for (const category of RETENTION_CATEGORIES) {
      const mode: RetentionMode = input.trigger === 'ADMIN_REPORT' || REPORT_ONLY_CATEGORIES.includes(category) ? 'REPORT' : modes[category];
      try {
        results.push(await prisma.$transaction(async (tx) => {
          const plan = await plans[category](tx, now);
          const purgeable = Object.entries(plan.counts).filter(([kind]) => !plan.reviewOnly?.includes(kind)).reduce((sum, [, count]) => sum + count, 0);
          const candidateCount = Object.values(plan.counts).reduce((sum, count) => sum + count, 0);
          const purgedCount = mode === 'APPLY' && purgeable > 0 ? await plan.purge(tx) : 0;
          const row = await tx.retentionRun.create({
            data: {
              category,
              mode,
              trigger: input.trigger,
              cutoffs: plan.cutoffs,
              counts: plan.counts,
              candidateCount,
              purgedCount,
              actorUserId: input.actorUserId,
              startedAt: now,
              finishedAt: new Date(),
            },
          });
          await appendAdminAudit(tx, {
            actorUserId: input.actorUserId,
            action: mode === 'APPLY' ? 'RETENTION_PURGED' : 'RETENTION_REPORTED',
            entityType: 'RETENTION',
            entityId: row.id,
            metadata: { category, trigger: input.trigger, counts: plan.counts, purgedCount },
          });
          return { category, mode, counts: plan.counts, purgedCount };
        }, { timeout: 120_000 }));
      } catch (error) {
        logError('retention_category_failed', error, { category });
      }
    }
    logInfo('retention_run_finished', { trigger: input.trigger, categories: results.length });
    return results;
  }

  async setMode(category: RetentionCategory, mode: RetentionMode, adminUserId: string, requestId?: string) {
    if (mode === 'APPLY' && REPORT_ONLY_CATEGORIES.includes(category))
      throw new AppError(409, 'Financial records are report-only.', 'RETENTION_REPORT_ONLY');
    await prisma.$transaction(async (tx) => {
      const before = (await tx.retentionPolicySetting.findUnique({ where: { category } }))?.mode ?? 'REPORT';
      await tx.retentionPolicySetting.upsert({
        where: { category },
        create: { category, mode, updatedById: adminUserId },
        update: { mode, updatedById: adminUserId },
      });
      await appendAdminAudit(tx, {
        actorUserId: adminUserId,
        action: 'RETENTION_MODE_CHANGED',
        entityType: 'RETENTION',
        entityId: category,
        requestId,
        metadata: { category, from: before, to: mode },
      });
    });
    return this.overview();
  }

  async overview(): Promise<RetentionOverview> {
    const modes = await this.modes();
    const categories: RetentionCategorySummary[] = [];
    for (const category of RETENTION_CATEGORIES) {
      const runs = await prisma.retentionRun.findMany({ where: { category }, orderBy: { startedAt: 'desc' }, take: 5 });
      categories.push({
        category,
        ...RETENTION_RULES[category],
        mode: modes[category],
        reportOnly: REPORT_ONLY_CATEGORIES.includes(category),
        runs: runs.map((run) => ({
          id: run.id,
          mode: run.mode,
          trigger: run.trigger,
          counts: run.counts as Record<string, number>,
          candidateCount: run.candidateCount,
          purgedCount: run.purgedCount,
          startedAt: run.startedAt.toISOString(),
        })),
      });
    }
    return { categories };
  }
}
