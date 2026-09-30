import {
  TEAM_REVIEW_EDIT_DAYS,
  TEAM_REVIEW_MINIMUM_FOR_AVERAGE,
  TEAM_REVIEW_WINDOW_DAYS,
  teamReviewInputSchema,
  type AdminTeamReview,
  type AdminTeamReviewQuery,
  type ModerateTeamReviewInput,
  type MyTeamReview,
  type TeamReviewContext,
  type TeamReviewIneligibleReason,
  type TeamReviewInput,
  type TeamReviewSummary,
} from '@footy-finder/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { appendAdminAudit } from '../admin/admin-audit.js';

const DAY = 86_400_000;

type ReviewRow = Prisma.TeamReviewGetPayload<object>;
const toMine = (row: ReviewRow): MyTeamReview => ({
  id: row.id,
  rating: row.rating,
  text: row.text,
  textStatus: row.textStatus,
  status: row.status,
  editableUntil: row.editableUntil.toISOString(),
  createdAt: row.createdAt.toISOString(),
});

const adminInclude = {
  match: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
  author: { select: { id: true, username: true, profile: { select: { displayName: true } } } },
} as const;
type AdminRow = Prisma.TeamReviewGetPayload<{ include: typeof adminInclude }>;
const toAdmin = (row: AdminRow): AdminTeamReview => ({
  id: row.id,
  match: row.match,
  team: row.team,
  author: { id: row.author.id, displayName: row.author.profile?.displayName ?? row.author.username },
  rating: row.rating,
  text: row.text,
  textStatus: row.textStatus,
  status: row.status,
  reportedAt: row.reportedAt?.toISOString() ?? null,
  moderationNote: row.moderationNote,
  createdAt: row.createdAt.toISOString(),
});

type Eligibility =
  | { eligible: true; side: 'HOME' | 'AWAY'; team: { id: string; name: string }; editableUntil: Date; reviewableUntil: Date }
  | { eligible: false; reason: TeamReviewIneligibleReason; team: { id: string; name: string } | null; editableUntil: Date | null; reviewableUntil: Date | null };

/**
 * Gate 8 / TKT-809 (DEC-017, as confirmed by DEC-020 and D24).
 * - Who: a player in the kickoff lineup record who played (D14), about the opposing side's team,
 *   once the referee's or an admin's result is final and the match was played or forfeited. The
 *   individuals' side of an "Open to both" match can review the home team; nobody can review a side
 *   of individual players. Members of the reviewed team cannot review it. One review per match.
 * - The rating counts at once; text is public only after an admin approves it. The author is kept
 *   privately for moderation and never shown publicly.
 * - A review can be left until 14 days after the final result (CEO, 2026-09-30).
 * - Edits until 7 days after the final result; the author may delete at any time (kept as DELETED).
 * - Public: average and count only with at least three visible reviews; hidden, reported and
 *   deleted reviews never count.
 */
export class TeamReviewsService {
  private async eligibility(matchId: string, userId: string, now: Date): Promise<Eligibility> {
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: {
        result: { select: { finalSource: true, outcomeType: true, submittedAt: true } },
        lineupEntries: { where: { userId }, select: { side: true, didNotPlay: true } },
        teamSides: { select: { side: true, teamId: true, teamNameSnapshot: true } },
      },
    });
    if (!match) throw new AppError(404, 'Match not found.', 'MATCH_NOT_FOUND');
    const result = match.result;
    const editableUntil = result ? new Date(result.submittedAt.getTime() + TEAM_REVIEW_EDIT_DAYS * DAY) : null;
    const reviewableUntil = result ? new Date(result.submittedAt.getTime() + TEAM_REVIEW_WINDOW_DAYS * DAY) : null;
    const entry = match.lineupEntries[0];
    const opposing = entry ? match.teamSides.find(({ side }) => side !== entry.side) : undefined;
    const team = opposing?.teamId ? { id: opposing.teamId, name: opposing.teamNameSnapshot } : null;
    const no = (reason: TeamReviewIneligibleReason): Eligibility => ({ eligible: false, reason, team, editableUntil, reviewableUntil });
    if (!result || result.finalSource === 'LEGACY') return no('NOT_FINAL');
    if (result.outcomeType === 'ABANDONED') return no('ABANDONED');
    if (!entry || entry.didNotPlay) return no('NOT_IN_LINEUP');
    if (!team) return no('NO_OPPOSING_TEAM');
    if (await prisma.teamMembership.count({ where: { teamId: team.id, userId } })) return no('OWN_TEAM');
    if (now > reviewableUntil!) return no('REVIEW_WINDOW_CLOSED');
    return { eligible: true, side: entry.side === 'HOME' ? 'AWAY' : 'HOME', team, editableUntil: editableUntil!, reviewableUntil: reviewableUntil! };
  }

  async context(matchId: string, userId: string, now = new Date()): Promise<TeamReviewContext> {
    const eligibility = await this.eligibility(matchId, userId, now);
    const review = await prisma.teamReview.findUnique({ where: { matchId_authorUserId: { matchId, authorUserId: userId } } });
    return {
      eligible: eligibility.eligible,
      reason: 'reason' in eligibility ? eligibility.reason : null,
      team: eligibility.team,
      editableUntil: eligibility.editableUntil?.toISOString() ?? null,
      reviewableUntil: eligibility.reviewableUntil?.toISOString() ?? null,
      review: review && review.status !== 'DELETED' ? toMine(review) : null,
    };
  }

  async create(matchId: string, userId: string, input: TeamReviewInput, now = new Date()) {
    const { rating, text } = teamReviewInputSchema.parse(input);
    const eligibility = await this.eligibility(matchId, userId, now);
    if ('reason' in eligibility)
      throw new AppError(409, 'You cannot review a team for this match.', 'REVIEW_NOT_ALLOWED', { reason: eligibility.reason });
    try {
      const created = await prisma.teamReview.create({
        data: {
          matchId,
          authorUserId: userId,
          teamId: eligibility.team.id,
          side: eligibility.side,
          rating,
          text: text ?? null,
          textStatus: text ? 'PENDING' : null,
          editableUntil: eligibility.editableUntil,
        },
      });
      return toMine(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new AppError(409, 'You have already reviewed this match.', 'REVIEW_EXISTS');
      throw error;
    }
  }

  async update(matchId: string, userId: string, input: TeamReviewInput, now = new Date()) {
    const { rating, text } = teamReviewInputSchema.parse(input);
    const review = await prisma.teamReview.findUnique({ where: { matchId_authorUserId: { matchId, authorUserId: userId } } });
    if (!review || review.status === 'DELETED') throw new AppError(404, 'Review not found.', 'REVIEW_NOT_FOUND');
    if (now > review.editableUntil)
      throw new AppError(409, 'Reviews can be edited for 7 days after the final result.', 'REVIEW_EDIT_CLOSED');
    const textChanged = (text ?? null) !== review.text;
    const updated = await prisma.teamReview.update({
      where: { id: review.id },
      data: {
        rating,
        ...(textChanged ? { text: text ?? null, textStatus: text ? 'PENDING' : null } : {}),
      },
    });
    return toMine(updated);
  }

  async remove(matchId: string, userId: string) {
    const review = await prisma.teamReview.findUnique({ where: { matchId_authorUserId: { matchId, authorUserId: userId } } });
    if (!review || review.status === 'DELETED') throw new AppError(404, 'Review not found.', 'REVIEW_NOT_FOUND');
    await prisma.teamReview.update({ where: { id: review.id }, data: { status: 'DELETED' } });
    return { id: review.id, deleted: true as const };
  }

  /** Public and anonymous. */
  async teamSummary(teamId: string): Promise<TeamReviewSummary> {
    const visible = await prisma.teamReview.findMany({
      where: { teamId, status: 'VISIBLE', reportedAt: null },
      select: { id: true, rating: true, text: true, textStatus: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    if (visible.length < TEAM_REVIEW_MINIMUM_FOR_AVERAGE)
      return { enoughReviews: false, averageRating: null, reviewCount: null, reviews: [] };
    const average = visible.reduce((total, { rating }) => total + rating, 0) / visible.length;
    return {
      enoughReviews: true,
      averageRating: Math.round(average * 10) / 10,
      reviewCount: visible.length,
      reviews: visible.slice(0, 50).map((review) => ({
        id: review.id,
        rating: review.rating,
        text: review.textStatus === 'APPROVED' ? review.text : null,
        createdAt: review.createdAt.toISOString(),
      })),
    };
  }

  /** A member of the reviewed team reports a review; it stops counting until an admin decides. */
  async report(teamId: string, reviewId: string, userId: string) {
    if (!(await prisma.teamMembership.count({ where: { teamId, userId } })))
      throw new AppError(403, 'Only members of this team can report its reviews.', 'TEAM_FORBIDDEN');
    const review = await prisma.teamReview.findFirst({ where: { id: reviewId, teamId, status: 'VISIBLE' } });
    if (!review) throw new AppError(404, 'Review not found.', 'REVIEW_NOT_FOUND');
    if (!review.reportedAt) await prisma.teamReview.update({ where: { id: review.id }, data: { reportedAt: new Date() } });
    return { id: review.id, reported: true as const };
  }

  async adminList(query: AdminTeamReviewQuery): Promise<AdminTeamReview[]> {
    const where: Prisma.TeamReviewWhereInput = query.queue === 'pending'
      ? { textStatus: 'PENDING', status: { not: 'DELETED' } }
      : query.queue === 'reported'
        ? { reportedAt: { not: null }, status: 'VISIBLE' }
        : {};
    const rows = await prisma.teamReview.findMany({ where, include: adminInclude, orderBy: { createdAt: 'asc' }, take: 200 });
    return rows.map(toAdmin);
  }

  async moderate(reviewId: string, adminUserId: string, input: ModerateTeamReviewInput, requestId: string) {
    const row = await serializableTransaction(async (tx) => {
      const review = await tx.teamReview.findUnique({ where: { id: reviewId } });
      if (!review || review.status === 'DELETED') throw new AppError(404, 'Review not found.', 'REVIEW_NOT_FOUND');
      if ((input.action === 'APPROVE_TEXT' || input.action === 'REJECT_TEXT') && !review.text)
        throw new AppError(409, 'This review has no text.', 'REVIEW_HAS_NO_TEXT');
      const data: Prisma.TeamReviewUpdateInput = {
        moderatedBy: { connect: { id: adminUserId } },
        moderatedAt: new Date(),
        moderationNote: input.note ?? null,
        ...(input.action === 'APPROVE_TEXT' ? { textStatus: 'APPROVED' as const } : {}),
        ...(input.action === 'REJECT_TEXT' ? { textStatus: 'REJECTED' as const } : {}),
        ...(input.action === 'HIDE' ? { status: 'HIDDEN' as const } : {}),
        ...(input.action === 'RESTORE' ? { status: 'VISIBLE' as const, reportedAt: null } : {}),
      };
      const updated = await tx.teamReview.update({ where: { id: reviewId }, data, include: adminInclude });
      await appendAdminAudit(tx, {
        actorUserId: adminUserId,
        action: `TEAM_REVIEW_${input.action}`,
        entityType: 'TEAM_REVIEW',
        entityId: reviewId,
        requestId,
        metadata: { note: input.note ?? null, teamId: review.teamId, matchId: review.matchId },
      });
      return updated;
    });
    return toAdmin(row);
  }
}
