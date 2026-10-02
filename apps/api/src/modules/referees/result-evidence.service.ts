import { shownName } from '../users/hidden-account.js';
import {
  getMatchEndsAt,
  MATCH_RESULT_PROBLEM_MESSAGES,
  validateMatchResult,
  type CaptainResultInput,
  type CaptainResultSubmissionView,
  type MatchLineupPlayer,
  type MatchResultContext,
  type ReportResultProblemInput,
  type ResultProblemReportView,
} from '@footy-finder/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import { AppError } from '../../errors/app-error.js';
import { buildLineup } from '../matches/lineup-record.js';
import { managedTeamSides } from '../team-matches/team-side-authority.js';
import { playerHostId } from '../matches/host.js';

/** D11: captains may send their own version until 24 hours after the scheduled end. */
export const CAPTAIN_VERSION_WINDOW_HOURS = 24;
/** D6: a problem may be reported until 24 hours after the result became final. */
export const PROBLEM_REPORT_WINDOW_HOURS = 24;
const HOUR = 3_600_000;

const matchSelect = {
  id: true,
  mode: true,
  status: true,
  startsAt: true,
  durationMinutes: true,
  goNoGoAt: true,
  createdById: true,
  hostedByFootyFinder: true,
  referee: { select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } } },
  result: { select: { finalSource: true, submittedAt: true } },
} satisfies Prisma.MatchSelect;
type EvidenceMatch = Prisma.MatchGetPayload<{ select: typeof matchSelect }>;

const toSubmissionView = (row: {
  id: string; side: 'HOME' | 'AWAY' | null; outcomeType: 'PLAYED' | 'FORFEIT' | 'ABANDONED'; homeScore: number; awayScore: number;
  forfeitWinner: 'HOME' | 'AWAY' | null; goals: Prisma.JsonValue; createdAt: Date;
}): CaptainResultSubmissionView => ({
  id: row.id,
  side: row.side,
  outcomeType: row.outcomeType,
  homeScore: row.homeScore,
  awayScore: row.awayScore,
  forfeitWinner: row.forfeitWinner,
  goals: (Array.isArray(row.goals) ? row.goals : []) as CaptainResultSubmissionView['goals'],
  createdAt: row.createdAt.toISOString(),
});
const toReportView = (row: { id: string; message: string; status: 'OPEN' | 'RESOLVED'; resolutionNote: string | null; createdAt: Date; resolvedAt: Date | null }): ResultProblemReportView => ({
  id: row.id,
  message: row.message,
  status: row.status,
  resolutionNote: row.resolutionNote,
  createdAt: row.createdAt.toISOString(),
  resolvedAt: row.resolvedAt?.toISOString() ?? null,
});

/**
 * Gate 8 / TKT-806 (DEC-020). Captains cannot dispute the referee's result (D5, D6). They may:
 * - D10/D11: send their own version (team match: each side's owner/captains; Quick Match: the
 *   host; the individuals' side of an "Open to both" match has no captain) from the scheduled end
 *   until 24 hours after it. Only admins (and the sender) see it; it never changes the result.
 * - D6: report a problem within 24 hours of the result becoming final, for the admin queue.
 */
export class ResultEvidenceService {
  private async load(matchId: string) {
    const match = await prisma.match.findUnique({ where: { id: matchId }, select: matchSelect });
    if (!match) throw new AppError(404, 'Match not found.', 'MATCH_NOT_FOUND');
    return match;
  }

  /** Who the viewer speaks for: a Quick Match host (side null) or the side they captain. */
  private async captaincy(match: EvidenceMatch, userId: string) {
    if (match.mode === 'QUICK_GAME') return playerHostId(match) === userId ? { side: null } : null;
    const [side] = await managedTeamSides(prisma, match.id, userId);
    return side ? { side } : null;
  }

  private windows(match: EvidenceMatch, now: Date) {
    const endsAt = getMatchEndsAt(match);
    const versionUntil = new Date(endsAt.getTime() + CAPTAIN_VERSION_WINDOW_HOURS * HOUR);
    const refereed = Boolean(match.goNoGoAt) && match.status !== 'CANCELLED';
    const finalResult = match.result && match.result.finalSource !== 'LEGACY' ? match.result : null;
    const reportUntil = finalResult ? new Date(finalResult.submittedAt.getTime() + PROBLEM_REPORT_WINDOW_HOURS * HOUR) : null;
    return {
      endsAt,
      versionUntil,
      versionOpen: refereed && now >= endsAt && now <= versionUntil,
      reportUntil,
      reportOpen: refereed && Boolean(reportUntil) && now <= reportUntil!,
    };
  }

  private async lineup(matchId: string): Promise<{ recorded: boolean; players: MatchLineupPlayer[] }> {
    const recorded = await prisma.matchLineupEntry.findMany({
      where: { matchId },
      select: { userId: true, displayNameSnapshot: true, user: { select: { accountStatus: true } }, side: true, role: true, slotIndex: true, didNotPlay: true },
      orderBy: [{ side: 'asc' }, { role: 'asc' }, { displayNameSnapshot: 'asc' }],
    });
    if (recorded.length)
      return { recorded: true, players: recorded.map(({ displayNameSnapshot, user, ...entry }) => ({ ...entry, displayName: shownName(user.accountStatus, displayNameSnapshot) })) };
    const live = await buildLineup(prisma, matchId);
    return {
      recorded: false,
      players: live.map((entry) => ({ userId: entry.userId, displayName: entry.displayNameSnapshot, side: entry.side, role: entry.role, slotIndex: entry.slotIndex, didNotPlay: false })),
    };
  }

  async context(matchId: string, userId: string, now = new Date()): Promise<MatchResultContext> {
    const match = await this.load(matchId);
    const captaincy = await this.captaincy(match, userId);
    const windows = this.windows(match, now);
    const [lineup, mine, reports] = await Promise.all([
      captaincy ? this.lineup(matchId) : Promise.resolve({ recorded: false, players: [] as MatchLineupPlayer[] }),
      prisma.captainResultSubmission.findFirst({ where: { matchId, submittedById: userId }, orderBy: { createdAt: 'desc' } }),
      prisma.resultProblemReport.findMany({ where: { matchId, reporterUserId: userId }, orderBy: { createdAt: 'desc' } }),
    ]);
    return {
      referee: match.referee
        ? { id: match.referee.id, displayName: match.referee.profile?.displayName ?? match.referee.username, avatarUrl: match.referee.profile?.avatarUrl ?? null }
        : null,
      lineupRecorded: lineup.recorded,
      lineup: lineup.players,
      viewerSide: captaincy?.side ?? null,
      canSubmitVersion: Boolean(captaincy) && windows.versionOpen,
      submitVersionFrom: match.goNoGoAt ? windows.endsAt.toISOString() : null,
      submitVersionUntil: match.goNoGoAt ? windows.versionUntil.toISOString() : null,
      mySubmission: mine ? toSubmissionView(mine) : null,
      canReportProblem: Boolean(captaincy) && windows.reportOpen && !reports.some(({ status }) => status === 'OPEN'),
      reportProblemUntil: windows.reportUntil?.toISOString() ?? null,
      myReports: reports.map(toReportView),
    };
  }

  async submitVersion(matchId: string, userId: string, input: CaptainResultInput, now = new Date()) {
    const match = await this.load(matchId);
    const captaincy = await this.captaincy(match, userId);
    if (!captaincy)
      throw new AppError(403, 'Only a team owner or captain, or the host of a Quick Match, can send their version.', 'RESULT_VERSION_FORBIDDEN');
    if (!this.windows(match, now).versionOpen)
      throw new AppError(409, 'You can send your version from the end of the match until 24 hours after it.', 'RESULT_VERSION_CLOSED');
    const { players } = await this.lineup(matchId);
    const problems = validateMatchResult(input, players, { captain: true });
    if (problems.length)
      throw new AppError(400, problems.map((problem) => MATCH_RESULT_PROBLEM_MESSAGES[problem]).join(' '), 'RESULT_INVALID', { problems });
    const created = await prisma.captainResultSubmission.create({
      data: {
        matchId,
        side: captaincy.side,
        submittedById: userId,
        outcomeType: input.outcome,
        homeScore: input.homeScore,
        awayScore: input.awayScore,
        forfeitWinner: input.outcome === 'FORFEIT' ? input.forfeitWinner ?? null : null,
        goals: input.goals.map(({ side, ownGoal, scorerUserId, assistUserId }) => ({
          side,
          ownGoal,
          scorerUserId: ownGoal ? null : scorerUserId ?? null,
          assistUserId: ownGoal ? null : assistUserId ?? null,
        })),
      },
    });
    return toSubmissionView(created);
  }

  async reportProblem(matchId: string, userId: string, input: ReportResultProblemInput, now = new Date()) {
    const match = await this.load(matchId);
    const captaincy = await this.captaincy(match, userId);
    if (!captaincy)
      throw new AppError(403, 'Only a team owner or captain, or the host of a Quick Match, can report a problem with the result.', 'RESULT_PROBLEM_FORBIDDEN');
    if (!this.windows(match, now).reportOpen)
      throw new AppError(409, 'Problems can be reported within 24 hours of the final result.', 'RESULT_PROBLEM_CLOSED');
    try {
      const created = await prisma.resultProblemReport.create({
        data: { matchId, reporterUserId: userId, side: captaincy.side, message: input.message },
      });
      return toReportView(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new AppError(409, 'You already have an open report for this match.', 'RESULT_PROBLEM_ALREADY_OPEN');
      throw error;
    }
  }
}
