import { Prisma, type Notification } from '../../generated/prisma/client.js';
import type {
  AdminDisputeQuery,
  CreateDisputeInput,
  ResolveDisputeInput,
  ResultInput,
  ReviewDisputeInput,
} from '@footy-finder/shared';
import { prisma } from '../../database/prisma.js';
import { AppError } from '../../errors/app-error.js';
import { emitDomainEventBestEffort } from '../../events/domain-events.js';
import { appendAdminAudit } from '../admin/admin-audit.js';
import { notificationDedupeKey, persistNotifications } from '../notifications/notification-writer.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { toPublicUser } from '../users/user.mapper.js';
import { hostAudience, playerHostId } from '../matches/host.js';

const actorSelect = {
  id: true,
  email: true,
  username: true,
  createdAt: true,
  profile: { include: { preferredPositions: true } },
  teamMemberships: { include: { team: true }, orderBy: { joinedAt: 'asc' as const } },
} as const;
const disputeInclude = {
  openedBy: { select: actorSelect },
  assignedAdmin: { select: actorSelect },
} as const;
const revisionInclude = { createdByAdmin: { select: actorSelect } } as const;
type DisputeRow = Prisma.DisputeGetPayload<{ include: typeof disputeInclude }>;
type RevisionRow = Prisma.MatchResultRevisionGetPayload<{ include: typeof revisionInclude }>;

const revisionDto = (row: RevisionRow) => ({
  id: row.id,
  matchResultId: row.matchResultId,
  revisionNumber: row.revisionNumber,
  homeScore: row.homeScore,
  awayScore: row.awayScore,
  scorers: row.scorersSnapshot as Array<{ participantId: string; team: 'HOME' | 'AWAY'; goals: number }>,
  reason: row.reason,
  createdAt: row.createdAt.toISOString(),
  ...(row.createdByAdmin ? { createdByAdmin: toPublicUser(row.createdByAdmin) } : {}),
});
const disputeDto = (row: DisputeRow, admin: boolean) => ({
  id: row.id,
  type: row.type,
  referenceId: row.referenceId,
  reason: row.reason,
  details: row.details,
  status: row.status,
  ...(row.resolutionOutcome ? { resolutionOutcome: row.resolutionOutcome } : {}),
  ...(row.resolutionSummary ? { resolutionSummary: row.resolutionSummary } : {}),
  ...(row.resolvedAt ? { resolvedAt: row.resolvedAt.toISOString() } : {}),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  ...(admin ? { evidenceSnapshot: row.evidenceSnapshot as Record<string, unknown>, openedBy: toPublicUser(row.openedBy) } : {}),
  ...(admin && row.assignedAdmin ? { assignedAdmin: toPublicUser(row.assignedAdmin) } : {}),
});

export class DisputesService {
  constructor(private readonly notifications = new NotificationsService()) {}

  async create(userId: string, input: CreateDisputeInput) {
    // Gate 8 (DEC-020, D21): results can no longer be disputed; captains report a problem instead.
    if (input.type === 'MATCH_RESULT')
      throw new AppError(409, 'Match results are recorded by the FootyFinder referee and are final. A team captain or the host can report a problem from the match page within 24 hours.', 'RESULT_DISPUTES_RETIRED');
    const evidenceSnapshot = await this.bookingEvidence(userId, input.referenceId);
    const existing = await prisma.dispute.findFirst({
      where: { openedByUserId: userId, type: input.type, referenceId: input.referenceId, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
      include: disputeInclude,
    });
    if (existing) throw new AppError(409, 'You already have an open dispute for this item.', 'DISPUTE_ALREADY_OPEN');
    try {
      const row = await prisma.dispute.create({ data: { openedByUserId: userId, ...input, evidenceSnapshot }, include: disputeInclude });
      return disputeDto(row, false);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new AppError(409, 'You already have an open dispute for this item.', 'DISPUTE_ALREADY_OPEN');
      throw error;
    }
  }

  async listMine(userId: string) {
    const rows = await prisma.dispute.findMany({ where: { openedByUserId: userId }, include: disputeInclude, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((row) => disputeDto(row, false));
  }

  async listAdmin(query: AdminDisputeQuery, adminUserId: string) {
    const rows = await prisma.dispute.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.assignedToMe ? { assignedAdminUserId: adminUserId } : {}),
      },
      include: disputeInclude,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((row) => disputeDto(row, true));
  }

  async getAdmin(disputeId: string) {
    const row = await prisma.dispute.findUnique({ where: { id: disputeId }, include: disputeInclude });
    if (!row) throw new AppError(404, 'Dispute not found.', 'DISPUTE_NOT_FOUND');
    const revisions = row.type === 'MATCH_RESULT'
      ? await prisma.matchResultRevision.findMany({ where: { matchResultId: row.referenceId }, include: revisionInclude, orderBy: { revisionNumber: 'asc' } })
      : [];
    return { ...disputeDto(row, true), ...(revisions.length ? { resultRevisions: revisions.map(revisionDto) } : {}) };
  }

  async review(disputeId: string, adminUserId: string, input: ReviewDisputeInput, requestId: string) {
    const row = await prisma.$transaction(async (tx) => {
      const current = await tx.dispute.findUnique({ where: { id: disputeId } });
      if (!current) throw new AppError(404, 'Dispute not found.', 'DISPUTE_NOT_FOUND');
      if (!['OPEN', 'UNDER_REVIEW'].includes(current.status))
        throw new AppError(409, 'This dispute is already closed.', 'DISPUTE_CLOSED');
      const updated = await tx.dispute.update({
        where: { id: disputeId },
        data: { status: 'UNDER_REVIEW', assignedAdminUserId: input.assignedToMe ? adminUserId : null },
        include: disputeInclude,
      });
      await appendAdminAudit(tx, { actorUserId: adminUserId, action: 'DISPUTE_REVIEW_STARTED', entityType: 'DISPUTE', entityId: disputeId, requestId });
      return updated;
    });
    return disputeDto(row, true);
  }

  async resolve(disputeId: string, adminUserId: string, input: ResolveDisputeInput, requestId: string) {
    let notifications: Notification[] = [];
    let targetMatchId: string | undefined;
    let resultChanged = false;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Dispute" WHERE "id" = ${disputeId}::uuid FOR UPDATE`;
      const dispute = await tx.dispute.findUnique({ where: { id: disputeId } });
      if (!dispute) throw new AppError(404, 'Dispute not found.', 'DISPUTE_NOT_FOUND');
      if (!['OPEN', 'UNDER_REVIEW'].includes(dispute.status))
        throw new AppError(409, 'This dispute is already closed.', 'DISPUTE_CLOSED');
      this.assertOutcomeMatches(dispute.type, input.outcome);
      const recipients = new Set<string>([dispute.openedByUserId]);
      if (input.outcome === 'RESULT_CORRECTED') {
        const resolution = await this.correctResult(tx, dispute.referenceId, input.correctedResult, adminUserId);
        targetMatchId = resolution.matchId;
        resultChanged = true;
        resolution.recipientIds.forEach((id) => recipients.add(id));
      } else if (dispute.type === 'MATCH_RESULT') {
        targetMatchId = (await tx.matchResult.findUnique({ where: { id: dispute.referenceId }, select: { matchId: true } }))?.matchId;
      }
      const status = input.outcome === 'RESULT_CONFIRMED' || input.outcome === 'BOOKING_REJECTED' ? 'REJECTED' : 'RESOLVED';
      await tx.dispute.update({
        where: { id: disputeId },
        data: { status, assignedAdminUserId: adminUserId, resolutionOutcome: input.outcome, resolutionSummary: input.resolutionSummary, resolvedAt: new Date() },
      });
      notifications = await persistNotifications(tx, [...recipients].map((recipientId) => ({
        userId: recipientId,
        type: 'DISPUTE_RESOLVED' as const,
        title: 'Dispute resolved',
        message: input.resolutionSummary,
        targetPath: dispute.type === 'MATCH_RESULT' && targetMatchId ? `/matches/${targetMatchId}` : '/bookings',
        dedupeKey: notificationDedupeKey('dispute', disputeId, 'resolved', recipientId),
      })));
      await appendAdminAudit(tx, {
        actorUserId: adminUserId,
        action: 'DISPUTE_RESOLVED',
        entityType: 'DISPUTE',
        entityId: disputeId,
        requestId,
        metadata: { type: dispute.type, outcome: input.outcome, referenceId: dispute.referenceId },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    this.notifications.publishPersistedMany(notifications);
    if (resultChanged && targetMatchId) emitDomainEventBestEffort('match:updated', { matchId: targetMatchId });
    return this.getAdmin(disputeId);
  }

  async revisions(userId: string, resultId: string) {
    await this.resultEvidence(userId, resultId);
    const rows = await prisma.matchResultRevision.findMany({ where: { matchResultId: resultId }, include: revisionInclude, orderBy: { revisionNumber: 'asc' } });
    return rows.map(revisionDto);
  }

  private async resultEvidence(userId: string, resultId: string): Promise<Prisma.InputJsonObject> {
    const result = await prisma.matchResult.findUnique({
      where: { id: resultId },
      include: {
        scorers: true,
        revisions: { orderBy: { revisionNumber: 'desc' }, take: 1 },
        match: { include: { participants: true, teamSides: { include: { team: { include: { memberships: true } } } } } },
      },
    });
    if (!result) throw new AppError(404, 'Dispute target not found.', 'DISPUTE_TARGET_NOT_FOUND');
    const allowed = playerHostId(result.match) === userId
      || result.match.participants.some((item) => item.userId === userId)
      || result.match.teamSides.some((side) => side.team?.memberships.some((item) => item.userId === userId));
    if (!allowed) throw new AppError(404, 'Dispute target not found.', 'DISPUTE_TARGET_NOT_FOUND');
    if (result.submittedById === userId)
      throw new AppError(400, 'You cannot dispute a result you submitted.', 'DISPUTE_SELF_NOT_ALLOWED');
    return {
      matchResultId: result.id,
      matchId: result.matchId,
      matchName: result.match.name,
      homeScore: result.homeScore,
      awayScore: result.awayScore,
      revisionNumber: result.revisions[0]?.revisionNumber ?? 1,
      submittedById: result.submittedById,
      submittedAt: result.submittedAt.toISOString(),
      scorers: result.scorers.map(({ participantId, team, goals }) => ({ participantId, team, goals })),
    };
  }

  private async bookingEvidence(userId: string, reservationId: string): Promise<Prisma.InputJsonObject> {
    const reservation = await prisma.fieldReservation.findUnique({
      where: { id: reservationId },
      include: { match: { include: { participants: true } }, obligations: { include: { contributions: true } } },
    });
    if (!reservation) throw new AppError(404, 'Dispute target not found.', 'DISPUTE_TARGET_NOT_FOUND');
    const contributionIds = reservation.obligations.flatMap((item) => item.contributions.map((contribution) => contribution.userId));
    const allowed = playerHostId(reservation.match) === userId || reservation.match.participants.some((item) => item.userId === userId) || contributionIds.includes(userId);
    if (!allowed) throw new AppError(404, 'Dispute target not found.', 'DISPUTE_TARGET_NOT_FOUND');
    return {
      reservationId: reservation.id,
      matchId: reservation.matchId,
      matchName: reservation.match.name,
      status: reservation.status,
      startsAt: reservation.startsAt.toISOString(),
      endsAt: reservation.endsAt.toISOString(),
      priceCents: reservation.priceCentsSnapshot,
      currency: reservation.currencySnapshot,
      venueName: reservation.venueNameSnapshot,
      fieldName: reservation.fieldNameSnapshot,
      address: reservation.addressSnapshot,
      city: reservation.citySnapshot,
      fundedCents: reservation.obligations.flatMap((item) => item.contributions).filter((item) => item.status !== 'RELEASED').reduce((sum, item) => sum + item.amountCents, 0),
    };
  }

  private assertOutcomeMatches(type: 'MATCH_RESULT' | 'FIELD_BOOKING', outcome: ResolveDisputeInput['outcome']) {
    if (type === 'MATCH_RESULT' && !['RESULT_CONFIRMED', 'RESULT_CORRECTED'].includes(outcome))
      throw new AppError(400, 'Resolution outcome does not match this dispute.', 'DISPUTE_OUTCOME_INVALID');
    if (type === 'FIELD_BOOKING' && !['BOOKING_UPHELD', 'BOOKING_REJECTED'].includes(outcome))
      throw new AppError(400, 'Resolution outcome does not match this dispute.', 'DISPUTE_OUTCOME_INVALID');
  }

  private async correctResult(tx: Prisma.TransactionClient, resultId: string, input: ResultInput, adminUserId: string) {
    await tx.$queryRaw`SELECT "id" FROM "MatchResult" WHERE "id" = ${resultId}::uuid FOR UPDATE`;
    const result = await tx.matchResult.findUnique({ where: { id: resultId }, include: { match: { include: { participants: true } }, revisions: { orderBy: { revisionNumber: 'desc' }, take: 1 } } });
    if (!result) throw new AppError(404, 'Match result not found.', 'RESULT_NOT_FOUND');
    const participantMap = new Map(result.match.participants.map((participant) => [participant.id, participant]));
    const scorers = input.scorers.map((scorer) => {
      const participant = participantMap.get(scorer.participantId);
      if (!participant) throw new AppError(400, 'Every scorer must have participated in this Match.', 'INVALID_SCORER');
      return { participantId: scorer.participantId, team: participant.team, goals: scorer.goals };
    });
    const total = (side: 'HOME' | 'AWAY') => scorers.filter((item) => item.team === side).reduce((sum, item) => sum + item.goals, 0);
    if (total('HOME') !== input.homeScore || total('AWAY') !== input.awayScore)
      throw new AppError(400, 'Scorer goal totals must equal the final scores.', 'SCORER_TOTAL_MISMATCH');
    const revisionNumber = (result.revisions[0]?.revisionNumber ?? 0) + 1;
    await tx.matchScorer.deleteMany({ where: { matchResultId: resultId } });
    if (scorers.length) await tx.matchScorer.createMany({ data: scorers.map((item) => ({ matchResultId: resultId, ...item })) });
    await tx.matchResult.update({ where: { id: resultId }, data: { homeScore: input.homeScore, awayScore: input.awayScore } });
    await tx.matchResultRevision.create({ data: { matchResultId: resultId, revisionNumber, homeScore: input.homeScore, awayScore: input.awayScore, scorersSnapshot: scorers, reason: 'ADMIN_CORRECTION', createdByAdminUserId: adminUserId } });
    return { matchId: result.matchId, recipientIds: [...hostAudience(result.match), ...result.match.participants.map((item) => item.userId)] };
  }
}
