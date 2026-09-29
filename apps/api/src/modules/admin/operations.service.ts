import type { GoNoGoHealth, GoNoGoHealthItem, OperationsSummary } from '@footy-finder/shared';
import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import { operationalMetricsSnapshot } from '../../observability/operational-metrics.js';
import { GO_NO_GO_JOB_TYPE } from '../matches/go-no-go.js';
import {
  classifyGoNoGoJob,
  GO_NO_GO_OVERDUE_GRACE_MS,
  goNoGoJobMatchId,
  toGoNoGoHealthItem,
} from './go-no-go-health.js';

const GO_NO_GO_ITEM_LIMIT = 20;

const countBy = <T extends string>(rows: Array<{ key: T; count: number }>, key: T) =>
  rows.find((row) => row.key === key)?.count ?? 0;

export class OperationsService {
  async readiness() {
    const started = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    return {
      status: 'ready' as const,
      database: 'ready' as const,
      responseTimeMs: Date.now() - started,
    };
  }

  /**
   * DEC-018 monitoring: a T-30 go/no-go check that is overdue, failed or stuck, or a go/no-go match
   * past kickoff that was never decided, so an admin sees it before (or at) kickoff.
   */
  async goNoGoHealth(now = new Date()): Promise<GoNoGoHealth> {
    const lockTimeoutSeconds = env.DURABLE_JOB_LOCK_TIMEOUT_SECONDS;
    const overdueBefore = new Date(now.getTime() - GO_NO_GO_OVERDUE_GRACE_MS);
    const staleBefore = new Date(now.getTime() - lockTimeoutSeconds * 1000);
    const problemJobs = {
      type: GO_NO_GO_JOB_TYPE,
      OR: [
        { status: 'FAILED' as const },
        { status: 'PENDING' as const, runAt: { lt: overdueBefore } },
        { status: 'RUNNING' as const, lockedAt: { lt: staleBefore } },
      ],
    };
    const undecided = {
      goNoGoAt: { not: null },
      confirmedAt: null,
      status: { not: 'CANCELLED' as const },
      startsAt: { lt: now },
    };
    const [jobs, overdue, staleRunning, failed, unconfirmedPastKickoff, undecidedMatches] =
      await Promise.all([
        prisma.durableJob.findMany({
          where: problemJobs,
          orderBy: { runAt: 'asc' },
          take: GO_NO_GO_ITEM_LIMIT,
        }),
        prisma.durableJob.count({
          where: { type: GO_NO_GO_JOB_TYPE, status: 'PENDING', runAt: { lt: overdueBefore } },
        }),
        prisma.durableJob.count({
          where: { type: GO_NO_GO_JOB_TYPE, status: 'RUNNING', lockedAt: { lt: staleBefore } },
        }),
        prisma.durableJob.count({ where: { type: GO_NO_GO_JOB_TYPE, status: 'FAILED' } }),
        prisma.match.count({ where: undecided }),
        prisma.match.findMany({
          where: undecided,
          orderBy: { startsAt: 'asc' },
          take: GO_NO_GO_ITEM_LIMIT,
          select: { id: true, name: true, startsAt: true },
        }),
      ]);
    const matchIds = jobs.map(({ payload }) => goNoGoJobMatchId(payload)).filter((id): id is string => Boolean(id));
    const matches = new Map(
      (
        await prisma.match.findMany({
          where: { id: { in: matchIds } },
          select: { id: true, name: true, startsAt: true },
        })
      ).map((match) => [match.id, match]),
    );
    const items: GoNoGoHealthItem[] = [];
    for (const job of jobs) {
      const problem = classifyGoNoGoJob(job, now, lockTimeoutSeconds);
      const matchId = goNoGoJobMatchId(job.payload);
      if (problem) items.push(toGoNoGoHealthItem(job, problem, matchId ? matches.get(matchId) : undefined));
    }
    const listed = new Set(items.map(({ matchId }) => matchId));
    for (const match of undecidedMatches)
      if (!listed.has(match.id))
        items.push({
          jobId: null,
          matchId: match.id,
          matchName: match.name,
          startsAt: match.startsAt.toISOString(),
          runAt: null,
          status: null,
          attempts: 0,
          lastError: null,
          problem: 'UNCONFIRMED_PAST_KICKOFF',
        });
    return {
      overdue,
      staleRunning,
      failed,
      unconfirmedPastKickoff,
      items: items.slice(0, GO_NO_GO_ITEM_LIMIT),
    };
  }

  async summary(): Promise<OperationsSummary> {
    const dbStarted = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const databaseResponseTimeMs = Date.now() - dbStarted;
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    const now = new Date();
    const [
      accountGroups,
      admins,
      supportGroups,
      moderationOpen,
      disputesOpen,
      reservationGroups,
      matchGroups,
      jobGroups,
      overdueJobs,
      financeGroups,
      goNoGo,
    ] = await Promise.all([
      prisma.user.groupBy({ by: ['accountStatus'], _count: { _all: true } }),
      prisma.user.count({ where: { platformRole: 'ADMIN' } }),
      prisma.supportTicket.groupBy({
        by: ['priority'],
        where: { status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_ON_USER'] } },
        _count: { _all: true },
      }),
      prisma.moderationReport.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
      prisma.dispute.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
      prisma.fieldReservation.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.match.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.durableJob.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.durableJob.count({ where: { status: 'PENDING', runAt: { lt: now } } }),
      prisma.walletTransaction.groupBy({
        by: ['status'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
        _sum: { amountCents: true },
      }),
      this.goNoGoHealth(now),
    ]);
    const accounts = accountGroups.map((item) => ({
      key: item.accountStatus,
      count: item._count._all,
    }));
    const supports = supportGroups.map((item) => ({ key: item.priority, count: item._count._all }));
    const reservations = reservationGroups.map((item) => ({
      key: item.status,
      count: item._count._all,
    }));
    const matches = matchGroups.map((item) => ({ key: item.status, count: item._count._all }));
    const jobs = jobGroups.map((item) => ({ key: item.status, count: item._count._all }));
    const succeeded = financeGroups.find((item) => item.status === 'SUCCEEDED');
    const failed = financeGroups
      .filter((item) => item.status === 'FAILED' || item.status === 'ERROR')
      .reduce((sum, item) => sum + item._count._all, 0);
    const metrics = operationalMetricsSnapshot();
    return {
      generatedAt: now.toISOString(),
      runtime: {
        startedAt: metrics.startedAt.toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        nodeEnvironment: env.NODE_ENV,
      },
      database: { status: 'ready', responseTimeMs: databaseResponseTimeMs },
      accounts: {
        active: countBy(accounts, 'ACTIVE'),
        suspended: countBy(accounts, 'SUSPENDED'),
        banned: countBy(accounts, 'BANNED'),
        admins,
      },
      workQueues: {
        openSupportTickets: supports.reduce((sum, item) => sum + item.count, 0),
        urgentSupportTickets: countBy(supports, 'URGENT'),
        openModerationReports: moderationOpen,
        openDisputes: disputesOpen,
        fundingReservations: countBy(reservations, 'FUNDING'),
      },
      matches: {
        draft: countBy(matches, 'DRAFT'),
        open: countBy(matches, 'OPEN'),
        inProgress: countBy(matches, 'IN_PROGRESS'),
        awaitingResult: countBy(matches, 'AWAITING_RESULT'),
      },
      durableJobs: {
        pending: countBy(jobs, 'PENDING'),
        running: countBy(jobs, 'RUNNING'),
        failed: countBy(jobs, 'FAILED'),
        overdue: overdueJobs,
      },
      goNoGo,
      finance24Hours: {
        succeededTransactions: succeeded?._count._all ?? 0,
        failedTransactions: failed,
        settledValueCents: succeeded?._sum.amountCents ?? 0,
      },
      processMetrics: metrics.counters,
    };
  }
}
