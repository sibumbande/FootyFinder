import { shownName } from '../users/hidden-account.js';
import {
  getMatchEndsAt,
  type AdminCaptainVersion,
  type AdminRefereeReportQuery,
  type AdminRefereeReportRow,
  type AdminResultDetail,
  type AdminResultEntryInput,
  type AdminResultProblem,
  type AdminResultProblemQuery,
  type AdminResultQuery,
  type AdminResultQueueItem,
  type CaptainResultSubmissionView,
  type ResolveResultProblemInput,
} from '@footy-finder/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { emitDomainEventBestEffort } from '../../events/domain-events.js';
import { appendAdminAudit } from '../admin/admin-audit.js';
import { notificationDedupeKey, persistNotifications } from '../notifications/notification-writer.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RESULT_OVERDUE_HOURS, writeFinalResultInTx, type FinalResultReason } from './referee-results.js';

const HOUR = 3_600_000;
const RECENT_DAYS = 14;
const person = { select: { id: true, username: true, profile: { select: { displayName: true } } } } as const;
const nameOf = (user: { id: string; username: string; profile: { displayName: string } | null }) => ({
  id: user.id,
  displayName: user.profile?.displayName ?? user.username,
});

const queueSelect = {
  id: true,
  name: true,
  mode: true,
  status: true,
  startsAt: true,
  durationMinutes: true,
  refereeUserId: true,
  venue: { select: { name: true } },
  referee: person,
  teamSides: { select: { side: true, teamNameSnapshot: true } },
  lineupEntries: { select: { userId: true, didNotPlay: true } },
  result: {
    select: {
      outcomeType: true,
      homeScore: true,
      awayScore: true,
      forfeitWinner: true,
      finalSource: true,
      finalizedAt: true,
      goals: {
        orderBy: { sortOrder: 'asc' as const },
        select: {
          side: true,
          ownGoal: true,
          scorer: { select: { userId: true, displayNameSnapshot: true, user: { select: { accountStatus: true } } } },
          assist: { select: { userId: true, displayNameSnapshot: true, user: { select: { accountStatus: true } } } },
        },
      },
    },
  },
  captainSubmissions: { orderBy: { createdAt: 'desc' as const }, include: { submittedBy: person } },
  _count: { select: { resultProblemReports: { where: { status: 'OPEN' as const } } } },
} satisfies Prisma.MatchSelect;
type QueueRow = Prisma.MatchGetPayload<{ select: typeof queueSelect }>;

const sameResult = (a: { outcomeType: string; homeScore: number; awayScore: number; forfeitWinner: string | null }, b: typeof a) =>
  a.outcomeType === b.outcomeType && a.homeScore === b.homeScore && a.awayScore === b.awayScore && (a.forfeitWinner ?? null) === (b.forfeitWinner ?? null);

function toQueueItem(row: QueueRow, now: Date): AdminResultQueueItem {
  const endsAt = getMatchEndsAt(row);
  const latestBySubmitter = new Map<string, QueueRow['captainSubmissions'][number]>();
  for (const submission of row.captainSubmissions)
    if (!latestBySubmitter.has(submission.submittedById)) latestBySubmitter.set(submission.submittedById, submission);
  const latest = [...latestBySubmitter.values()];
  const versions: AdminCaptainVersion[] = latest.map((submission) => ({
    id: submission.id,
    side: submission.side,
    outcomeType: submission.outcomeType,
    homeScore: submission.homeScore,
    awayScore: submission.awayScore,
    forfeitWinner: submission.forfeitWinner,
    goals: (Array.isArray(submission.goals) ? submission.goals : []) as CaptainResultSubmissionView['goals'],
    createdAt: submission.createdAt.toISOString(),
    submittedBy: nameOf(submission.submittedBy),
    mismatch: row.result
      ? !sameResult(submission, row.result)
      : latest.some((other) => other.id !== submission.id && !sameResult(submission, other)),
  }));
  const sideName = (side: 'HOME' | 'AWAY') =>
    row.teamSides.find((teamSide) => teamSide.side === side)?.teamNameSnapshot
    ?? (side === 'HOME' ? 'Team A' : row.mode === 'TEAM_MATCH' ? 'Individual players' : 'Team B');
  return {
    matchId: row.id,
    name: row.name,
    mode: row.mode,
    status: row.status,
    startsAt: row.startsAt.toISOString(),
    matchEndsAt: endsAt.toISOString(),
    overdue: !row.result && now.getTime() > endsAt.getTime() + RESULT_OVERDUE_HOURS * HOUR,
    venueName: row.venue.name,
    sides: { HOME: sideName('HOME'), AWAY: sideName('AWAY') },
    referee: row.referee ? nameOf(row.referee) : null,
    refereeAlsoPlayed: Boolean(row.refereeUserId) && row.lineupEntries.some(({ userId, didNotPlay }) => userId === row.refereeUserId && !didNotPlay),
    result: row.result
      ? {
          outcomeType: row.result.outcomeType,
          homeScore: row.result.homeScore,
          awayScore: row.result.awayScore,
          forfeitWinner: row.result.forfeitWinner,
          finalSource: row.result.finalSource,
          finalizedAt: row.result.finalizedAt?.toISOString() ?? null,
          goals: row.result.goals.map((goal) => ({
            side: goal.side,
            ownGoal: goal.ownGoal,
            scorer: goal.scorer ? { userId: goal.scorer.userId, displayName: shownName(goal.scorer.user.accountStatus, goal.scorer.displayNameSnapshot) } : null,
            assist: goal.assist ? { userId: goal.assist.userId, displayName: shownName(goal.assist.user.accountStatus, goal.assist.displayNameSnapshot) } : null,
          })),
        }
      : null,
    captainVersions: versions,
    mismatch: versions.some(({ mismatch }) => mismatch),
    openProblemCount: row._count.resultProblemReports,
  };
}

const problemInclude = { reporter: person, resolvedBy: person, match: { select: { name: true } } } as const;
const toProblem = (row: Prisma.ResultProblemReportGetPayload<{ include: typeof problemInclude }>): AdminResultProblem => ({
  id: row.id,
  matchId: row.matchId,
  matchName: row.match.name,
  side: row.side,
  message: row.message,
  status: row.status,
  resolutionNote: row.resolutionNote,
  createdAt: row.createdAt.toISOString(),
  resolvedAt: row.resolvedAt?.toISOString() ?? null,
  reporter: nameOf(row.reporter),
  resolvedBy: row.resolvedBy ? nameOf(row.resolvedBy) : null,
});

/** "YYYY-MM-DD" in South African time (UTC+2, no daylight saving) to a UTC instant. */
const saDayStart = (day: string) => new Date(`${day}T00:00:00.000+02:00`);

/**
 * Gate 8 / TKT-807 (DEC-020): admin results operations.
 * - D3: the queue of started refereed matches still without a result (overdue after 2h, D4), with
 *   the captains' versions as evidence and mismatch flags; admins enter the result when the referee
 *   did not. D5: admins correct a clear recording error with a written reason. Both need a fresh
 *   MFA check (D25, on the routes), are audited, and write a new permanent revision.
 * - D6: the problem-report queue. D8: matches refereed per referee in a date range (no money).
 * - D17 (reversed): "Referee also played" is shown for the record only.
 */
export class AdminResultsService {
  constructor(private readonly notifications = new NotificationsService()) {}

  async queue(query: AdminResultQuery, now = new Date()): Promise<AdminResultQueueItem[]> {
    const where: Prisma.MatchWhereInput = query.view === 'awaiting'
      ? { goNoGoAt: { not: null }, status: { in: ['IN_PROGRESS', 'AWAITING_RESULT'] }, result: null }
      : { result: { finalSource: { in: ['REFEREE', 'ADMIN'] }, finalizedAt: { gt: new Date(now.getTime() - RECENT_DAYS * 86_400_000) } } };
    const rows = await prisma.match.findMany({
      where,
      select: queueSelect,
      orderBy: { startsAt: query.view === 'awaiting' ? 'asc' : 'desc' },
      take: 200,
    });
    return rows.map((row) => toQueueItem(row, now));
  }

  async detail(matchId: string, now = new Date()): Promise<AdminResultDetail> {
    const row = await prisma.match.findUnique({ where: { id: matchId }, select: queueSelect });
    if (!row) throw new AppError(404, 'Match not found.', 'MATCH_NOT_FOUND');
    const [lineup, revisions, problems] = await Promise.all([
      prisma.matchLineupEntry.findMany({
        where: { matchId },
        select: { userId: true, displayNameSnapshot: true, user: { select: { accountStatus: true } }, side: true, role: true, slotIndex: true, didNotPlay: true },
        orderBy: [{ side: 'asc' }, { role: 'asc' }, { displayNameSnapshot: 'asc' }],
      }),
      prisma.matchResultRevision.findMany({
        where: { matchResult: { matchId } },
        orderBy: { revisionNumber: 'asc' },
        include: { createdBy: person, createdByAdmin: person },
      }),
      prisma.resultProblemReport.findMany({ where: { matchId }, orderBy: { createdAt: 'desc' }, include: problemInclude }),
    ]);
    return {
      ...toQueueItem(row, now),
      lineup: lineup.map(({ displayNameSnapshot, user, ...entry }) => ({ ...entry, displayName: shownName(user.accountStatus, displayNameSnapshot) })),
      revisions: revisions.map((revision) => {
        const snapshot = revision.scorersSnapshot as { correctionReason?: string } | null;
        const author = revision.createdBy ?? revision.createdByAdmin;
        return {
          revisionNumber: revision.revisionNumber,
          reason: revision.reason,
          outcomeType: revision.outcomeType,
          homeScore: revision.homeScore,
          awayScore: revision.awayScore,
          createdBy: author ? nameOf(author) : null,
          correctionReason: snapshot && typeof snapshot === 'object' && typeof snapshot.correctionReason === 'string' ? snapshot.correctionReason : null,
          createdAt: revision.createdAt.toISOString(),
        };
      }),
      problems: problems.map(toProblem),
    };
  }

  /** D3 (admin entry, only once the match has kicked off and has no result) and D5 (correction). */
  async write(matchId: string, adminUserId: string, input: AdminResultEntryInput, reason: Exclude<FinalResultReason, 'REFEREE_SUBMISSION'>, requestId: string) {
    let written;
    try {
      written = await serializableTransaction(async (tx) => {
        if (reason === 'ADMIN_ENTRY') {
          const match = await tx.match.findUnique({ where: { id: matchId }, select: { status: true, goNoGoAt: true } });
          if (!match) throw new AppError(404, 'Match not found.', 'MATCH_NOT_FOUND');
          // A completed match already has a final result; writeFinalResultInTx refuses it as such.
          if (!match.goNoGoAt || !['IN_PROGRESS', 'AWAITING_RESULT', 'COMPLETED'].includes(match.status))
            throw new AppError(409, 'A result can be entered only for a refereed match that has kicked off.', 'MATCH_NOT_STARTED');
        }
        const result = await writeFinalResultInTx(tx, { matchId, result: input.result, actorUserId: adminUserId, reason, correctionReason: input.reason });
        await appendAdminAudit(tx, {
          actorUserId: adminUserId,
          action: reason === 'ADMIN_ENTRY' ? 'RESULT_ENTERED' : 'RESULT_CORRECTED',
          entityType: 'MATCH',
          entityId: matchId,
          requestId,
          metadata: {
            reason: input.reason,
            revisionNumber: result.revisionNumber,
            outcome: input.result.outcome,
            homeScore: input.result.homeScore,
            awayScore: input.result.awayScore,
          },
        });
        return result;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new AppError(409, 'This match already has a final result.', 'RESULT_ALREADY_FINAL');
      throw error;
    }
    this.notifications.publishPersistedMany(written.notifications);
    emitDomainEventBestEffort('match:updated', { matchId });
    return this.detail(matchId);
  }

  async problems(query: AdminResultProblemQuery): Promise<AdminResultProblem[]> {
    const rows = await prisma.resultProblemReport.findMany({
      where: { status: query.status },
      include: problemInclude,
      orderBy: { createdAt: query.status === 'OPEN' ? 'asc' : 'desc' },
      take: 200,
    });
    return rows.map(toProblem);
  }

  /** D6/D19: resolve with a note; the reporter is told in the app. */
  async resolveProblem(reportId: string, adminUserId: string, input: ResolveResultProblemInput, requestId: string) {
    const created = await serializableTransaction(async (tx) => {
      const report = await tx.resultProblemReport.findUnique({ where: { id: reportId }, include: { match: { select: { name: true } } } });
      if (!report) throw new AppError(404, 'Report not found.', 'RESULT_PROBLEM_NOT_FOUND');
      if (report.status !== 'OPEN') throw new AppError(409, 'This report is already resolved.', 'RESULT_PROBLEM_RESOLVED');
      await tx.resultProblemReport.update({
        where: { id: reportId },
        data: { status: 'RESOLVED', resolutionNote: input.note, resolvedById: adminUserId, resolvedAt: new Date() },
      });
      await appendAdminAudit(tx, {
        actorUserId: adminUserId,
        action: 'RESULT_PROBLEM_RESOLVED',
        entityType: 'RESULT_PROBLEM_REPORT',
        entityId: reportId,
        requestId,
        metadata: { matchId: report.matchId, note: input.note },
      });
      return persistNotifications(tx, [{
        userId: report.reporterUserId,
        type: 'RESULT_PROBLEM_RESOLVED',
        title: 'Result report reviewed',
        message: `FootyFinder reviewed your report about ${report.match.name}: ${input.note}`,
        targetPath: `/matches/${report.matchId}`,
        dedupeKey: notificationDedupeKey('result-problem', reportId, 'resolved'),
      }]);
    });
    this.notifications.publishPersistedMany(created);
    const row = await prisma.resultProblemReport.findUniqueOrThrow({ where: { id: reportId }, include: problemInclude });
    return toProblem(row);
  }

  /**
   * D8: matches refereed per referee, by kickoff date (South African time), inclusive. A match
   * counts for the referee who submitted its result (their REFEREE_SUBMISSION revision is
   * permanent, so a later admin correction does not remove it). No money.
   */
  async refereeReport(query: AdminRefereeReportQuery): Promise<AdminRefereeReportRow[]> {
    const from = saDayStart(query.from);
    const until = new Date(saDayStart(query.to).getTime() + 86_400_000);
    const revisions = await prisma.matchResultRevision.findMany({
      where: {
        reason: 'REFEREE_SUBMISSION',
        matchResult: { match: { startsAt: { gte: from, lt: until } } },
      },
      select: {
        createdAt: true,
        createdBy: person,
        matchResult: { select: { match: { select: { id: true, name: true, startsAt: true, venue: { select: { name: true } } } } } },
      },
      orderBy: { matchResult: { match: { startsAt: 'asc' } } },
    });
    const rows = new Map<string, AdminRefereeReportRow>();
    for (const revision of revisions) {
      if (!revision.createdBy) continue;
      const referee = nameOf(revision.createdBy);
      const row = rows.get(referee.id) ?? { referee, matchCount: 0, matches: [] };
      const { match } = revision.matchResult;
      row.matches.push({ matchId: match.id, name: match.name, startsAt: match.startsAt.toISOString(), venueName: match.venue.name, submittedAt: revision.createdAt.toISOString() });
      row.matchCount = row.matches.length;
      rows.set(referee.id, row);
    }
    return [...rows.values()].sort((a, b) => b.matchCount - a.matchCount || a.referee.displayName.localeCompare(b.referee.displayName));
  }
}
