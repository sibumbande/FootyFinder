import {
  createDefaultFormation,
  decideOtherSide,
  isLobbyFrozen,
  OTHER_SIDE_REFUSAL_MESSAGE,
  type LoadTeamIntoMatchInput,
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
import { enqueueFillReminderJob } from '../matches/fill-reminder.js';
import { notificationDedupeKey, persistNotifications } from '../notifications/notification-writer.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { assertPlayerSlotWindow, BookingsService, rethrowReservationConflict } from '../bookings/bookings.service.js';
import { toMatch } from '../matches/match.mapper.js';
import { matchInclude } from '../matches/match.query.js';
import { createPublicMatchSlug } from '../matches/public-match.js';
import { appendTeamMatchAudit } from './team-match-audit.js';
import { assertTeamMatchCommand } from './team-side-authority.js';
import { enqueueTeamGoNoGoJobs } from './team-match-meters.js';
import { settleTicketsOnCancellationInTx } from '../tickets/ticket-cancellation.js';
import { enqueueWithdrawalChoiceEmail } from '../tickets/ticket-emails.js';
import { onRefereedMatchPublished } from '../referees/referee-assignment.js';
import {
  enqueueTeamMatchEmail,
  enqueueTeamMatchSideJobs,
  enqueueUnmatchedCancelAfterWithdrawal,
  TEAM_MATCH_EMAIL_SUBJECT,
  teamMatchMessage,
  unmatchedCancelAt,
  type TeamMatchEmailKind,
} from './team-match-jobs.js';
import { copySavedSquad, overlappingSquadMembers, savedFormation } from './team-squad.js';
import { girlsOnlySquadExclusions } from '../matches/girls-only.js';

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
 * their team brings. At most two published matches may be waiting for an opponent (D12). No money moves at
 * publication (DEC-021 D7): the team pays for its places as match tickets by the T-2h cutoff.
 */
export class TeamMatchesService {
  constructor(
    private readonly bookings = new BookingsService(),
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
        // Serialises the publish limit for this team (DEC-021 D7: no money check at publish).
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
        // DEC-021 D7: no money check at publish; the T-4h alert and the T-2h cutoff enforce payment.
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
            girlsOnly: input.girlsOnly ?? false,
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
          excludeUserIds: new Set([
            ...(await overlappingSquadMembers(tx, { teamId, match: created, matchName: created.name, actorUserId: userId })),
            ...(await girlsOnlySquadExclusions(tx, { teamId, match: created, actorUserId: userId })),
          ]),
        });
        await tx.fieldReservation.create({ data: slot.reservation(created.id, 'PUBLIC', now) });
        await appendTeamMatchAudit(tx, {
          matchId: created.id, command: 'TEAM_MATCH_PUBLISHED', teamId, side: 'HOME', actorUserId: userId,
          payload: { otherSideMode: input.otherSideMode, substituteCount: fee.substituteCount, teamFeeCents: fee.totalCents },
        });
        await enqueueTeamMatchSideJobs(tx, { id: created.id, startsAt, otherSideMode }, now);
        await enqueueTeamGoNoGoJobs(tx, { id: created.id, startsAt }, now);
        // Gate 8 / DEC-020: every match needs a FootyFinder referee (default referee, D28).
        await onRefereedMatchPublished(tx, created, now);
        return tx.match.findUniqueOrThrow({ where: { id: created.id }, include: matchInclude });
      });
      return toMatch(match, { viewerCanManage: true, viewerCanChat: true });
    } catch (error) {
      return rethrowReservationConflict(error);
    }
  }

  /**
   * Gate 7 / DEC-019 decision C: "Load my team". Instant, first come first served, in both modes:
   * an owner or captain of another team takes the other side with their whole saved squad and
   * chooses their subs, which sets their own team fee and fill meter. Under the Match row lock,
   * which an individual joining also takes, so exactly one of them wins. Allowed only while the
   * side has no individual players (N1: an emptied individuals side reopens) and before T-30.
   */
  async loadTeam(matchId: string, userId: string, input: LoadTeamIntoMatchInput): Promise<Match> {
    const result = await serializableTransaction(async (tx) => {
      await lockMatchForFormation(tx, matchId);
      const now = new Date();
      const match = await tx.match.findUnique({
        where: { id: matchId },
        select: {
          id: true, name: true, status: true, format: true, startsAt: true, durationMinutes: true, goNoGoAt: true, otherSideMode: true, otherSideTakenBy: true,
          girlsOnly: true,
          venue: { select: { name: true } },
          participants: { where: { status: 'JOINED' }, select: { userId: true } },
          teamSides: { select: { side: true, teamId: true, teamNameSnapshot: true } },
        },
      });
      if (!match || !match.otherSideMode) throw new AppError(404, 'Team match not found.', 'TEAM_MATCH_NOT_FOUND');
      if (!['OPEN', 'READY'].includes(match.status)) throw new AppError(409, 'This match is no longer open.', 'MATCH_CLOSED');
      if (isLobbyFrozen(match, now) || now >= match.startsAt)
        throw new AppError(409, 'The lineup is locked 30 minutes before kickoff.', 'LINEUP_LOCKED');
      const decision = decideOtherSide(
        { mode: match.otherSideMode, takenBy: match.otherSideTakenBy, joinedIndividuals: match.participants.length },
        'TEAM',
      );
      if ('reason' in decision) throw new AppError(409, OTHER_SIDE_REFUSAL_MESSAGE[decision.reason], 'OTHER_SIDE_TAKEN');
      const home = match.teamSides.find(({ side }) => side === 'HOME');
      const team = await tx.team.findUnique({
        where: { id: input.teamId },
        include: { memberships: { select: { userId: true, role: true } } },
      });
      if (!team) throw new AppError(404, 'Team not found.', 'TEAM_NOT_FOUND');
      if (team.archivedAt) throw new AppError(409, 'This team has been closed.', 'TEAM_ARCHIVED');
      const actor = team.memberships.find((member) => member.userId === userId);
      if (!actor || (actor.role !== 'OWNER' && actor.role !== 'CAPTAIN'))
        throw new AppError(403, 'Only the team owner or a captain can load the team into a match.', 'TEAM_FORBIDDEN');
      // N2: nobody plays against their own team.
      const homeMemberIds = home?.teamId
        ? new Set((await tx.teamMembership.findMany({ where: { teamId: home.teamId }, select: { userId: true } })).map((row) => row.userId))
        : new Set<string>();
      if (home?.teamId === team.id || team.memberships.some((member) => homeMemberIds.has(member.userId)))
        throw new AppError(409, "You can't play against your own team: a player is in both teams.", 'OWN_TEAM_CONFLICT');
      const fee = getTeamFee(match.format, input.substituteCount);
      const { formationKey } = await savedFormation(tx, team.id, match.format);
      await tx.match.update({ where: { id: matchId }, data: { otherSideTakenBy: 'TEAM' } });
      const away = await tx.matchTeam.create({
        data: {
          matchId, teamId: team.id, side: 'AWAY', organisingUserId: userId, formationKey,
          teamNameSnapshot: team.name, teamImageUrlSnapshot: team.profileImageUrl,
          primaryColorSnapshot: team.primaryColor, secondaryColorSnapshot: team.secondaryColor,
          starterCount: fee.starterCount, substituteCount: fee.substituteCount,
          placeFeeCents: fee.placeFeeCents, teamFeeCents: fee.totalCents,
        },
      });
      const excludeUserIds = new Set([
        ...(await overlappingSquadMembers(tx, { teamId: team.id, match, matchName: match.name, actorUserId: userId })),
        ...(await girlsOnlySquadExclusions(tx, { teamId: team.id, match, actorUserId: userId })),
      ]);
      await copySavedSquad(tx, { matchTeamId: away.id, teamId: team.id, side: 'AWAY', format: match.format, formationKey, actorUserId: userId, excludeUserIds });
      await appendTeamMatchAudit(tx, {
        matchId, command: 'OTHER_SIDE_TEAM_LOADED', teamId: team.id, side: 'AWAY', actorUserId: userId,
        payload: { substituteCount: fee.substituteCount, teamFeeCents: fee.totalCents, reopenedFromIndividuals: match.otherSideTakenBy === 'INDIVIDUALS' },
      });
      const homeManagers = home?.teamId
        ? await tx.teamMembership.findMany({ where: { teamId: home.teamId, role: { in: ['OWNER', 'CAPTAIN'] } }, select: { userId: true } })
        : [];
      for (const manager of homeManagers)
        await enqueueTeamMatchEmail(tx, { matchId, userId: manager.userId, kind: 'OPPONENT_FOUND', eventKey: away.id, otherTeamName: team.name });
      const homeMessage = teamMatchMessage('OPPONENT_FOUND', { name: match.name, startsAt: match.startsAt, venueName: match.venue.name, otherTeamName: team.name });
      const notifications = await persistNotifications(tx, [
        ...[...homeMemberIds].map((memberId) => ({
          userId: memberId, type: 'TEAM_MATCH_OPPONENT_FOUND' as const, title: 'Opponent found', message: homeMessage,
          targetPath: `/matches/${matchId}`, dedupeKey: notificationDedupeKey('team-match', matchId, 'opponent-found', away.id, memberId),
        })),
        ...team.memberships.map((member) => ({
          userId: member.userId, type: 'TEAM_MATCH_OPPONENT_FOUND' as const, title: 'Your team is in',
          message: `${team.name} took the other side of ${match.name} against ${home?.teamNameSnapshot ?? 'the home team'}. Pay for your players' match tickets by 2 hours before kick-off, or the match is cancelled.`,
          targetPath: `/matches/${matchId}`, dedupeKey: notificationDedupeKey('team-match', matchId, 'team-loaded', away.id, member.userId),
        })),
      ]);
      return { notifications, match: await tx.match.findUniqueOrThrow({ where: { id: matchId }, include: matchInclude }) };
    });
    this.notifications.publishPersistedMany(result.notifications);
    emitDomainEventBestEffort('match:updated', { matchId });
    return toMatch(result.match, { viewerCanManage: false, viewerCanChat: true });
  }

  /**
   * N5: the team that took the other side may withdraw only its own team, before T-30. Its held
   * meter money is released, its side is removed, the side reopens (the "Teams only" 24-hour rule
   * and the "Open to both" rules apply again) and the home team is told in-app and by email.
   */
  async withdrawTeam(matchId: string, userId: string) {
    const result = await serializableTransaction(async (tx) => {
      await lockMatchForFormation(tx, matchId);
      const now = new Date();
      const match = await tx.match.findUnique({
        where: { id: matchId },
        select: {
          id: true, name: true, status: true, startsAt: true, goNoGoAt: true, otherSideMode: true, otherSideTakenBy: true,
          venue: { select: { name: true } },
          teamSides: true,
        },
      });
      const away = match?.teamSides.find(({ side }) => side === 'AWAY');
      if (!match || !match.otherSideMode || match.otherSideTakenBy !== 'TEAM' || !away?.teamId)
        throw new AppError(409, 'No team has taken the other side of this match.', 'OTHER_SIDE_NOT_TEAM');
      if (!['OPEN', 'READY'].includes(match.status)) throw new AppError(409, 'This match is no longer open.', 'MATCH_CLOSED');
      await assertTeamMatchCommand(tx, { matchId, userId, command: 'WITHDRAW_TEAM' });
      if (isLobbyFrozen(match, now) || now >= match.startsAt)
        throw new AppError(409, 'The lineup is locked 30 minutes before kickoff.', 'LINEUP_LOCKED');
      // DEC-021 A5: every place the withdrawing team paid for gets the A3 choice (credit or refund, to the payer).
      const payers = await settleTicketsOnCancellationInTx(tx, matchId, now, { matchTeamId: away.id });
      await tx.matchTeam.delete({ where: { id: away.id } });
      await tx.match.update({ where: { id: matchId }, data: { otherSideTakenBy: null } });
      const audit = await appendTeamMatchAudit(tx, {
        matchId, command: 'OTHER_SIDE_TEAM_WITHDRAWN', teamId: away.teamId, side: 'AWAY', actorUserId: userId,
        payload: {
          teamName: away.teamNameSnapshot, substituteCount: away.substituteCount, teamFeeCents: away.teamFeeCents,
          paidPlaces: [...payers.byPayer.values()].reduce((sum, item) => sum + item.choiceSeats, 0),
        },
      });
      if (match.otherSideMode === 'TEAMS_ONLY') await enqueueUnmatchedCancelAfterWithdrawal(tx, match, audit.id, now);
      else await enqueueFillReminderJob(tx, matchId, match.startsAt, now);
      const home = match.teamSides.find(({ side }) => side === 'HOME');
      const homeMembers = home?.teamId
        ? await tx.teamMembership.findMany({ where: { teamId: home.teamId }, select: { userId: true, role: true } })
        : [];
      for (const member of homeMembers.filter(({ role }) => role === 'OWNER' || role === 'CAPTAIN'))
        await enqueueTeamMatchEmail(tx, { matchId, userId: member.userId, kind: 'OPPONENT_WITHDRAWN', eventKey: audit.id, otherTeamName: away.teamNameSnapshot });
      const message = teamMatchMessage('OPPONENT_WITHDRAWN', { name: match.name, startsAt: match.startsAt, venueName: match.venue.name, otherTeamName: away.teamNameSnapshot });
      const choiceDrafts = [];
      for (const [payerId, facts] of payers.byPayer) {
        const choice = facts.choiceSeats
          ? `${away.teamNameSnapshot} withdrew from ${match.name}. You paid ${formatRandAmount(facts.choiceCents)} for ${facts.choiceSeats === 1 ? '1 place' : `${facts.choiceSeats} places`}: choose a match credit or a full refund for each. If you don't choose within 7 days, you're refunded automatically.`
          : `${away.teamNameSnapshot} withdrew from ${match.name}. Your match credit has been returned to you.`;
        choiceDrafts.push({
          userId: payerId, type: 'TICKET_CHOICE_REQUIRED' as const, title: 'Your team withdrew: choose a credit or a refund', message: choice,
          targetPath: `/matches/${matchId}`, dedupeKey: notificationDedupeKey('team-match', matchId, 'withdrawal-choice', audit.id, payerId),
        });
        if (facts.choiceSeats) await enqueueWithdrawalChoiceEmail(tx, { userId: payerId, matchId, message: choice });
      }
      const notifications = await persistNotifications(tx, [
        ...homeMembers.map((member) => ({
          userId: member.userId, type: 'TEAM_MATCH_OPPONENT_WITHDRAWN' as const, title: 'Opponent withdrew', message,
          targetPath: `/matches/${matchId}`, dedupeKey: notificationDedupeKey('team-match', matchId, 'opponent-withdrew', audit.id, member.userId),
        })),
        ...choiceDrafts,
      ]);
      return { notifications };
    });
    this.notifications.publishPersistedMany(result.notifications);
    emitDomainEventBestEffort('match:updated', { matchId });
    return { withdrawn: true };
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
