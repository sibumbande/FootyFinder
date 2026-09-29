import {
  createDefaultFormation,
  formatRandAmount,
  getGoNoGoAt,
  getTeamFee,
  MATCH_DURATION_MINUTES,
  MATCH_FEE_CENTS,
  MAX_TEAM_MATCHES_AWAITING_OPPONENT,
  type CreateMatchInput,
  type Match,
} from '@footy-finder/shared';
import type { Notification, Prisma } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import { emitDomainEventBestEffort } from '../../events/domain-events.js';
import type { EmailProvider } from '../auth/email.provider.js';
import { lockMatchForFormation, MatchesRepository } from '../matches/matches.repository.js';
import { notificationDedupeKey, persistNotifications } from '../notifications/notification-writer.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { assertPlayerSlotWindow, BookingsService, rethrowReservationConflict } from '../bookings/bookings.service.js';
import { toMatch } from '../matches/match.mapper.js';
import { matchInclude } from '../matches/match.query.js';
import { createPublicMatchSlug } from '../matches/public-match.js';
import { TeamWalletRepository } from '../team-wallet/team-wallet.repository.js';
import { appendTeamMatchAudit } from './team-match-audit.js';
import {
  enqueueTeamMatchEmail,
  enqueueTeamMatchSideJobs,
  TEAM_MATCH_EMAIL_SUBJECT,
  teamMatchMessage,
  unmatchedCancelAt,
  type TeamMatchEmailKind,
} from './team-match-jobs.js';
import { copySavedSquad, savedFormation } from './team-squad.js';

/**
 * D12 / N6: published team matches of this home team whose other side is not taken yet. A side
 * is taken when a team has loaded it, or (individuals) when every starting position is claimed.
 */
export async function countTeamMatchesAwaitingOpponent(tx: Prisma.TransactionClient, teamId: string) {
  const matches = await tx.match.findMany({
    where: {
      otherSideMode: { not: null },
      status: { in: ['OPEN', 'READY'] },
      teamSides: { some: { teamId, side: 'HOME' } },
    },
    select: { otherSideTakenBy: true, formationSlots: { where: { team: 'AWAY' }, select: { participantId: true } } },
  });
  return matches.filter((match) =>
    match.otherSideTakenBy === null
    || (match.otherSideTakenBy === 'INDIVIDUALS' && match.formationSlots.some((slot) => !slot.participantId))).length;
}

/**
 * Gate 7 / TKT-704 (DEC-019): a team owner or captain publishes a team match at a managed venue
 * slot. It is always public; the captain chooses who can take the other side and how many subs
 * their team brings. Publishing needs the team wallet's AVAILABLE balance to cover the home fee
 * (a check, not a hold) and at most two published matches may be waiting for an opponent (D12).
 * No money moves at publication.
 */
export class TeamMatchesService {
  constructor(
    private readonly bookings = new BookingsService(),
    private readonly teamWallets = new TeamWalletRepository(),
    private readonly matches = new MatchesRepository(),
    private readonly notifications = new NotificationsService(),
  ) {}

  async create(input: CreateMatchInput, userId: string): Promise<Match> {
    const teamId = input.playAsTeamId;
    if (!teamId || !input.otherSideMode || input.teamSubstituteCount === undefined)
      throw new AppError(400, 'Choose your team, who can take the other side and your number of subs.', 'VALIDATION_ERROR');
    const otherSideMode = input.otherSideMode;
    const startsAt = new Date(input.startsAt);
    const now = new Date();
    assertPlayerSlotWindow(startsAt, now);
    const fee = getTeamFee(input.format, input.teamSubstituteCount);
    try {
      const match = await serializableTransaction(async (tx) => {
        // Serialises the publish limit and wallet check for this team.
        await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id" = ${teamId}::uuid FOR UPDATE`;
        const team = await tx.team.findUnique({
          where: { id: teamId },
          include: { memberships: { where: { userId }, select: { role: true } } },
        });
        if (!team) throw new AppError(404, 'Team not found.', 'TEAM_NOT_FOUND');
        if (team.archivedAt) throw new AppError(409, 'This team has been closed.', 'TEAM_ARCHIVED');
        if (!team.memberships.some(({ role }) => role === 'OWNER' || role === 'CAPTAIN'))
          throw new AppError(403, 'Only the team owner or a captain can create a team match.', 'TEAM_FORBIDDEN');
        if ((await countTeamMatchesAwaitingOpponent(tx, teamId)) >= MAX_TEAM_MATCHES_AWAITING_OPPONENT)
          throw new AppError(
            409,
            `Your team already has ${MAX_TEAM_MATCHES_AWAITING_OPPONENT} matches waiting for an opponent. Wait for one to fill or cancel one before publishing another.`,
            'TEAM_MATCHES_AWAITING_OPPONENT_LIMIT',
          );
        const account = await this.teamWallets.lockAccount(tx, teamId);
        const available = account.balanceCents - (await this.teamWallets.heldCents(tx, account.id));
        if (available < fee.totalCents)
          throw new AppError(
            409,
            `Top up your team wallet to at least ${formatRandAmount(fee.totalCents)} to publish this match.`,
            'TEAM_WALLET_TOP_UP_REQUIRED',
          );
        const slot = await this.bookings.playerSlot(tx, input.managedFieldId, input.format, startsAt);
        const { formationKey } = await savedFormation(tx, teamId, input.format);
        const created = await tx.match.create({
          data: {
            name: input.name,
            description: input.description,
            createdBy: { connect: { id: userId } },
            mode: 'TEAM_MATCH',
            format: input.format,
            // N4: an individuals side gets as many sub places as the home team chose.
            substituteCapacityPerTeam: fee.substituteCount,
            rollingSubstitutes: input.rollingSubstitutes,
            rules: input.rules,
            visibility: 'PUBLIC',
            publicSlug: createPublicMatchSlug(),
            startsAt,
            durationMinutes: MATCH_DURATION_MINUTES,
            // Individuals who join an "Open to both" other side pay the DEC-018 R80 each.
            feeCents: MATCH_FEE_CENTS,
            status: 'OPEN',
            goNoGoAt: getGoNoGoAt(startsAt),
            otherSideMode: input.otherSideMode,
            venue: { create: slot.venue },
            formationSlots: { create: createDefaultFormation(input.format) },
            teamSides: {
              create: {
                team: { connect: { id: teamId } },
                side: 'HOME',
                organisingUser: { connect: { id: userId } },
                formationKey,
                teamNameSnapshot: team.name,
                teamImageUrlSnapshot: team.profileImageUrl,
                primaryColorSnapshot: team.primaryColor,
                secondaryColorSnapshot: team.secondaryColor,
                starterCount: fee.starterCount,
                substituteCount: fee.substituteCount,
                placeFeeCents: fee.placeFeeCents,
                teamFeeCents: fee.totalCents,
              },
            },
          },
          include: { teamSides: true },
        });
        await copySavedSquad(tx, {
          matchTeamId: created.teamSides[0]!.id,
          teamId,
          side: 'HOME',
          format: input.format,
          formationKey,
          actorUserId: userId,
        });
        await tx.fieldReservation.create({ data: slot.reservation(created.id, 'PUBLIC', now) });
        await appendTeamMatchAudit(tx, {
          matchId: created.id, command: 'TEAM_MATCH_PUBLISHED', teamId, side: 'HOME', actorUserId: userId,
          payload: { otherSideMode: input.otherSideMode, substituteCount: fee.substituteCount, teamFeeCents: fee.totalCents },
        });
        await enqueueTeamMatchSideJobs(tx, { id: created.id, startsAt, otherSideMode }, now);
        return tx.match.findUniqueOrThrow({ where: { id: created.id }, include: matchInclude });
      });
      return toMatch(match, { viewerCanManage: true, viewerCanChat: true });
    } catch (error) {
      return rethrowReservationConflict(error);
    }
  }

  /**
   * D10 / decision E: a "Teams only" match whose other side no team has taken 24 hours before
   * kickoff is cancelled (nothing is held yet; the reservation is released and nothing is owed).
   * Idempotent: a taken, cancelled, confirmed or "Open to both" match is left alone.
   */
  async cancelUnmatched(matchId: string, now = new Date()) {
    const result = await serializableTransaction(async (tx) => {
      await lockMatchForFormation(tx, matchId);
      const match = await tx.match.findUnique({
        where: { id: matchId },
        select: { status: true, startsAt: true, otherSideMode: true, otherSideTakenBy: true, confirmedAt: true },
      });
      if (!match || match.otherSideMode !== 'TEAMS_ONLY' || match.otherSideTakenBy !== null
        || match.confirmedAt || !['OPEN', 'READY'].includes(match.status))
        return { outcome: 'NOT_APPLICABLE' as const, notifications: [] as Notification[] };
      if (now < unmatchedCancelAt(match.startsAt))
        throw Object.assign(new Error('The unmatched check is not due yet.'), { code: 'TEAM_MATCH_UNMATCHED_NOT_DUE' });
      const cancelled = await this.matches.cancelInTx(tx, matchId, 'NO_OPPONENT');
      await appendTeamMatchAudit(tx, { matchId, command: 'TEAM_MATCH_CANCELLED', payload: { reason: 'NO_OPPONENT' } });
      return { outcome: 'CANCELLED' as const, notifications: cancelled.notifications };
    });
    if (result.outcome === 'CANCELLED') {
      this.notifications.publishPersistedMany(result.notifications);
      emitDomainEventBestEffort('match:cancelled', { matchId });
    }
    return result;
  }

  /** Warns the home team 48 hours before kickoff that no team has taken a "Teams only" match. */
  async warnNoOpponent(matchId: string) {
    const notifications = await serializableTransaction(async (tx) => {
      await lockMatchForFormation(tx, matchId);
      const match = await tx.match.findUnique({
        where: { id: matchId },
        select: {
          name: true, startsAt: true, status: true, otherSideMode: true, otherSideTakenBy: true,
          venue: { select: { name: true } },
          teamSides: { where: { side: 'HOME' }, select: { team: { select: { memberships: { select: { userId: true, role: true } } } } } },
        },
      });
      if (!match || match.otherSideMode !== 'TEAMS_ONLY' || match.otherSideTakenBy !== null || !['OPEN', 'READY'].includes(match.status))
        return [] as Notification[];
      const members = match.teamSides[0]?.team?.memberships ?? [];
      const message = teamMatchMessage('NO_OPPONENT_WARNING', { name: match.name, startsAt: match.startsAt, venueName: match.venue.name });
      for (const member of members.filter(({ role }) => role === 'OWNER' || role === 'CAPTAIN'))
        await enqueueTeamMatchEmail(tx, { matchId, userId: member.userId, kind: 'NO_OPPONENT_WARNING', eventKey: 'warning' });
      return persistNotifications(tx, members.map(({ userId }) => ({
        userId,
        type: 'TEAM_MATCH_NO_OPPONENT_WARNING' as const,
        title: 'No opponent yet',
        message,
        targetPath: `/matches/${matchId}`,
        dedupeKey: notificationDedupeKey('team-match', matchId, 'no-opponent-warning', userId),
      })));
    });
    this.notifications.publishPersistedMany(notifications);
    return notifications;
  }

  /** Sends one operational team-match email (at-least-once, like the cancellation email). */
  async sendEmail(payload: unknown, emails: EmailProvider) {
    const { matchId, userId, kind, otherTeamName } = (payload ?? {}) as Record<string, unknown>;
    if (typeof matchId !== 'string' || typeof userId !== 'string'
      || !['OPPONENT_FOUND', 'NO_OPPONENT_WARNING', 'OPPONENT_WITHDRAWN'].includes(String(kind)))
      throw Object.assign(new Error('Invalid team-match email payload.'), { code: 'JOB_PAYLOAD_INVALID' });
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: { name: true, startsAt: true, status: true, venue: { select: { name: true } } },
    });
    if (!match || match.status === 'CANCELLED') return;
    const to = (await prisma.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email;
    if (!to) return;
    const emailKind = kind as TeamMatchEmailKind;
    const text = teamMatchMessage(emailKind, {
      name: match.name, startsAt: match.startsAt, venueName: match.venue.name,
      otherTeamName: typeof otherTeamName === 'string' ? otherTeamName : null,
    });
    await emails.send({
      to,
      subject: TEAM_MATCH_EMAIL_SUBJECT[emailKind],
      text: `${text}\n\nView the match: ${env.CLIENT_URL.replace(/\/$/, '')}/matches/${matchId}`,
    });
  }
}
