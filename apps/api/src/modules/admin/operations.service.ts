import type { OperationsSummary } from '@footy-finder/shared';
import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import { operationalMetricsSnapshot } from '../../observability/operational-metrics.js';

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
      finance24Hours: {
        succeededTransactions: succeeded?._count._all ?? 0,
        failedTransactions: failed,
        settledValueCents: succeeded?._sum.amountCents ?? 0,
      },
      processMetrics: metrics.counters,
    };
  }
}
