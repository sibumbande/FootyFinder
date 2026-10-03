import {
  effectiveOtherSide,
  formatRandAmount,
  getGoNoGoAt,
  getTeamFee,
  isLobbyFrozen,
  teamPaymentAlertAt,
  teamPaymentCutoffAt,
  type MatchCancellationReason,
  type TeamSide,
} from '@footy-finder/shared';
import type { Notification, Prisma } from '../../generated/prisma/client.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { emitDomainEventBestEffort } from '../../events/domain-events.js';
import { enqueueDurableJob } from '../../jobs/durable-jobs.js';
import { logInfo } from '../../observability/logger.js';
import { incrementOperationalMetric } from '../../observability/operational-metrics.js';
import { formatKickoffTime } from '../matches/cancellation-message.js';
import { lockMatchForFormation, MatchesRepository } from '../matches/matches.repository.js';
import { notificationDedupeKey, persistNotifications } from '../notifications/notification-writer.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { teamPaidSeats, teamSeats } from '../tickets/team-ticket-placement.js';
import { enqueueTeamPaymentDueEmail } from '../tickets/ticket-emails.js';
import { appendTeamMatchAudit } from './team-match-audit.js';
import { assertTeamMatchCommand } from './team-side-authority.js';
import { hasActiveReferee } from '../referees/referee-assignment.js';

/**
 * Team match fees, deadlines and the team T-30 go/no-go (DEC-019 as changed by DEC-021, CEO D1, D7, D10).
 * - Each team's fee is R80 x (starting positions + that team's subs). Its places are paid as named match tickets
 *   (modules/tickets/team-tickets.service.ts), not from a team wallet; nothing is held or captured.
 * - T-4h: if a team isn't fully paid, its owner/captains and the home organiser are alerted (in the app and by
 *   email) with what is still needed and the deadline.
 * - T-2h: if a team is still not fully paid, the fixture is cancelled (TEAM_UNPAID) and every payer gets the
 *   credit-or-refund choice for each place they paid for.
 * - T-30: the match goes ahead if a referee is assigned and, where individuals took the other side, every starting
 *   position there is claimed; a team side counts as paid if it was paid at the T-2h cutoff (not re-checked).
 * - The old 2-hour fill-meter reminder is retired (D10).
 */
export const TEAM_MATCH_GO_NO_GO_JOB_TYPE = 'TEAM_MATCH_GO_NO_GO';
/** Retired with the team wallet (D10); jobs already queued finish without doing anything. */
export const TEAM_METER_REMINDER_JOB_TYPE = 'TEAM_METER_REMINDER';
export const TEAM_PAYMENT_ALERT_JOB_TYPE = 'TEAM_PAYMENT_ALERT';
export const TEAM_PAYMENT_CUTOFF_JOB_TYPE = 'TEAM_PAYMENT_CUTOFF';
export const teamGoNoGoDedupeKey = (matchId: string) => `team-match-go-no-go:${matchId}`;
export const teamMeterReminderDedupeKey = (matchId: string) => `team-meter-reminder:${matchId}`;
export const teamPaymentAlertDedupeKey = (matchId: string) => `team-payment-alert:${matchId}`;
export const teamPaymentCutoffDedupeKey = (matchId: string) => `team-payment-cutoff:${matchId}`;

/** Scheduled in the transaction that publishes a team match. */
export async function enqueueTeamGoNoGoJobs(tx: Prisma.TransactionClient, match: { id: string; startsAt: Date }, now = new Date()) {
  await enqueueDurableJob(tx, {
    type: TEAM_MATCH_GO_NO_GO_JOB_TYPE,
    dedupeKey: teamGoNoGoDedupeKey(match.id),
    payload: { matchId: match.id },
    runAt: getGoNoGoAt(match.startsAt),
  });
  const alertAt = teamPaymentAlertAt(match.startsAt);
  if (alertAt > now)
    await enqueueDurableJob(tx, { type: TEAM_PAYMENT_ALERT_JOB_TYPE, dedupeKey: teamPaymentAlertDedupeKey(match.id), payload: { matchId: match.id }, runAt: alertAt });
  await enqueueDurableJob(tx, {
    type: TEAM_PAYMENT_CUTOFF_JOB_TYPE,
    dedupeKey: teamPaymentCutoffDedupeKey(match.id),
    payload: { matchId: match.id },
    runAt: new Date(Math.max(teamPaymentCutoffAt(match.startsAt).getTime(), now.getTime())),
  });
}

export class TeamGoNoGoNotDueError extends Error {}

const matchSelect = {
  id: true, name: true, format: true, status: true, startsAt: true, goNoGoAt: true, confirmedAt: true,
  otherSideMode: true, otherSideTakenBy: true,
  participants: { where: { status: 'JOINED' }, select: { userId: true } },
  formationSlots: { where: { team: 'AWAY' }, select: { participantId: true } },
  teamSides: {
    select: {
      id: true, side: true, teamId: true, teamNameSnapshot: true, starterCount: true, substituteCount: true,
      placeFeeCents: true, teamFeeCents: true, organisingUserId: true,
    },
  },
} satisfies Prisma.MatchSelect;
type MeterMatch = Prisma.MatchGetPayload<{ select: typeof matchSelect }>;
type TeamSideRecord = MeterMatch['teamSides'][number];

const retired = () => new AppError(410, 'Team fees are now paid as match tickets for named players.', 'TEAM_METER_RETIRED');

export class TeamMatchMetersService {
  constructor(
    private readonly matches = new MatchesRepository(),
    private readonly notifications = new NotificationsService(),
  ) {}

  /** Retired with the team wallet: a team's places are paid on its payment checklist. */
  async meter(_matchId: string, _side: TeamSide, _userId: string): Promise<never> {
    throw retired();
  }

  async fill(): Promise<never> {
    throw retired();
  }

  /**
   * D5 (as changed by DEC-021 D1): a team changes its own subs until the T-2h payment cutoff. The fee is
   * recalculated; it can never drop below the places already paid for (no refunds come from a subs change). N4: the
   * individuals side follows the home team's subs, never below the subs who have already joined.
   */
  async changeSubstitutes(matchId: string, side: TeamSide, userId: string, substituteCount: number, now = new Date()) {
    const result = await serializableTransaction(async (tx) => {
      await lockMatchForFormation(tx, matchId);
      const match = await this.load(tx, matchId);
      const teamSide = this.teamSide(match, side);
      await assertTeamMatchCommand(tx, { matchId, userId, command: 'CHANGE_SUBSTITUTES', side });
      this.assertOpen(match, now);
      if (now >= teamPaymentCutoffAt(match.startsAt))
        throw new AppError(409, 'Subs can be changed until 2 hours before kick-off.', 'TEAM_PAYMENTS_CLOSED');
      const selectedSubs = await tx.teamMatchSelection.count({ where: { matchTeamId: teamSide.id, status: 'SELECTED_SUBSTITUTE' } });
      if (substituteCount < selectedSubs)
        throw new AppError(409, `Your lineup already has ${selectedSubs} subs. Remove some before lowering the number.`, 'SUBSTITUTES_BELOW_SELECTED');
      const paid = await teamPaidSeats(tx, teamSide.id, teamPaymentCutoffAt(match.startsAt));
      if (teamSide.starterCount! + substituteCount < paid)
        throw new AppError(409, `${paid} places are already paid for, so you can't bring fewer than ${paid - teamSide.starterCount!} subs.`, 'SUBSTITUTES_BELOW_PAID');
      const joinedIndividualSubs = Math.max(0, match.participants.length - teamSide.starterCount!);
      if (side === 'HOME' && match.otherSideTakenBy === 'INDIVIDUALS' && substituteCount < joinedIndividualSubs)
        throw new AppError(409, `${joinedIndividualSubs} subs have already joined the other side, so you can't go below that.`, 'SUBSTITUTES_BELOW_JOINED');
      const fee = getTeamFee(match.format, substituteCount);
      await tx.matchTeam.update({ where: { id: teamSide.id }, data: { substituteCount, teamFeeCents: fee.totalCents } });
      if (side === 'HOME') await tx.match.update({ where: { id: matchId }, data: { substituteCapacityPerTeam: substituteCount } });
      await appendTeamMatchAudit(tx, {
        matchId, command: 'SUBSTITUTES_CHANGED', teamId: teamSide.teamId, side, actorUserId: userId,
        payload: { from: teamSide.substituteCount, to: substituteCount, teamFeeCents: fee.totalCents },
      });
      return { teamId: teamSide.teamId!, substituteCount, teamFeeCents: fee.totalCents };
    });
    emitDomainEventBestEffort('match:updated', { matchId });
    return result;
  }

  /** D1: the team T-30 go/no-go. Idempotent under the Match row lock; safe to run late or twice. Nothing is captured. */
  async decideGoNoGo(matchId: string, now = new Date()) {
    const result = await serializableTransaction(async (tx) => {
      await lockMatchForFormation(tx, matchId);
      const match = await tx.match.findUnique({ where: { id: matchId }, select: matchSelect });
      const none = { notifications: [] as Notification[] };
      if (!match || !match.otherSideMode || !match.goNoGoAt) return { outcome: 'NOT_APPLICABLE' as const, ...none };
      if (match.status === 'CANCELLED' || match.confirmedAt) return { outcome: 'ALREADY_DECIDED' as const, ...none };
      if (!['OPEN', 'READY'].includes(match.status)) return { outcome: 'NOT_APPLICABLE' as const, ...none };
      if (now < match.goNoGoAt) throw new TeamGoNoGoNotDueError();
      const facts = await this.readiness(tx, match);
      if (facts.go) {
        await tx.match.update({ where: { id: matchId }, data: { confirmedAt: now } });
        await appendTeamMatchAudit(tx, { matchId, command: 'TEAM_MATCH_CONFIRMED', payload: { paid: true } });
        const recipients = await this.everyone(tx, match);
        const notifications = await persistNotifications(tx, recipients.map((userId) => ({
          userId,
          type: 'MATCH_CONFIRMED' as const,
          title: 'Match confirmed',
          message: `Both sides are ready, so ${match.name} goes ahead.`,
          targetPath: `/matches/${matchId}`,
          dedupeKey: notificationDedupeKey('match', matchId, 'go-no-go-confirmed', userId),
        })));
        return { outcome: 'CONFIRMED' as const, notifications, ...facts };
      }
      const cancelled = await this.matches.cancelInTx(tx, matchId, facts.reason!);
      await appendTeamMatchAudit(tx, { matchId, command: 'TEAM_MATCH_NO_GO', payload: { reason: facts.reason!, homeFull: facts.homeFull, otherReady: facts.otherReady, refereeReady: facts.refereeReady } });
      return { outcome: 'CANCELLED' as const, notifications: cancelled.notifications, ...facts };
    });
    if (result.outcome === 'CONFIRMED' || result.outcome === 'CANCELLED') {
      incrementOperationalMetric(result.outcome === 'CONFIRMED' ? 'go_no_go_confirmed_total' : 'go_no_go_cancelled_total');
      logInfo('team_go_no_go_decided', { matchId, outcome: result.outcome });
      this.notifications.publishPersistedMany(result.notifications);
      emitDomainEventBestEffort(result.outcome === 'CONFIRMED' ? 'match:updated' : 'match:cancelled', { matchId });
    }
    return result;
  }

  /** Retired with the team wallet (D10): the T-4h payment alert replaces it. */
  async remindUnfilledMeters(_matchId: string) {
    return [] as Notification[];
  }

  /**
   * D1, T-4h: each team that isn't fully paid gets one alert, in the app and by email, to its owner/captains (and
   * the home organiser): "Pay the remaining R160 by 13:30 to confirm your team." The link opens the payment
   * checklist with the unpaid players ticked.
   */
  async paymentAlert(matchId: string, now = new Date()) {
    const notifications = await serializableTransaction(async (tx) => {
      await lockMatchForFormation(tx, matchId);
      const match = await tx.match.findUnique({ where: { id: matchId }, select: matchSelect });
      if (!match || !match.otherSideMode || match.confirmedAt || !['OPEN', 'READY'].includes(match.status)) return [] as Notification[];
      if (now >= teamPaymentCutoffAt(match.startsAt)) return [] as Notification[];
      const drafts = [];
      for (const teamSide of match.teamSides) {
        const owed = await this.owedCents(tx, match, teamSide);
        if (!teamSide.teamId || owed <= 0) continue;
        const managers = await tx.teamMembership.findMany({ where: { teamId: teamSide.teamId, role: { in: ['OWNER', 'CAPTAIN'] } }, select: { userId: true } });
        const recipients = new Set([...managers.map(({ userId }) => userId), ...(teamSide.side === 'HOME' ? [teamSide.organisingUserId] : [])]);
        const message = `Pay the remaining ${formatRandAmount(owed)} by ${formatKickoffTime(teamPaymentCutoffAt(match.startsAt))} to confirm ${teamSide.teamNameSnapshot}. If the team isn't fully paid by then, the match is cancelled.`;
        for (const userId of recipients) {
          drafts.push({
            userId,
            type: 'TEAM_PAYMENT_DUE' as const,
            title: 'Your team isn’t fully paid yet',
            message,
            targetPath: `/matches/${matchId}?pay=${teamSide.side.toLowerCase()}`,
            dedupeKey: notificationDedupeKey('team-match', matchId, 'payment-alert', teamSide.side, userId),
          });
          await enqueueTeamPaymentDueEmail(tx, { userId, matchId, side: teamSide.side, message });
        }
      }
      return persistNotifications(tx, drafts);
    });
    this.notifications.publishPersistedMany(notifications);
    return notifications;
  }

  /** D1, T-2h: a team still not fully paid cancels the fixture (TEAM_UNPAID); every payer gets the A3 choice. */
  async paymentCutoff(matchId: string, now = new Date()) {
    const result = await serializableTransaction(async (tx) => {
      await lockMatchForFormation(tx, matchId);
      const match = await tx.match.findUnique({ where: { id: matchId }, select: matchSelect });
      if (!match || !match.otherSideMode || match.confirmedAt || !['OPEN', 'READY'].includes(match.status)) return { cancelled: false, notifications: [] as Notification[] };
      if (now < teamPaymentCutoffAt(match.startsAt))
        throw Object.assign(new Error('The team payment cutoff is not due yet.'), { code: 'TEAM_PAYMENT_CUTOFF_NOT_DUE' });
      const unpaid: TeamSide[] = [];
      for (const teamSide of match.teamSides) if (teamSide.teamId && (await this.owedCents(tx, match, teamSide)) > 0) unpaid.push(teamSide.side);
      if (!unpaid.length) return { cancelled: false, notifications: [] as Notification[] };
      const cancelled = await this.matches.cancelInTx(tx, matchId, 'TEAM_UNPAID');
      await appendTeamMatchAudit(tx, { matchId, command: 'TEAM_MATCH_NO_GO', payload: { reason: 'TEAM_UNPAID', unpaidSides: unpaid } });
      return { cancelled: true, notifications: cancelled.notifications };
    });
    if (result.cancelled) {
      this.notifications.publishPersistedMany(result.notifications);
      emitDomainEventBestEffort('match:cancelled', { matchId });
      logInfo('team_payment_cutoff_cancelled', { matchId });
    }
    return result;
  }

  /** What a team still owes (0 when every place in its fee is paid for). */
  private async owedCents(tx: Prisma.TransactionClient, match: MeterMatch, teamSide: TeamSideRecord) {
    if (!teamSide.teamId || teamSide.placeFeeCents === null) return 0;
    const paid = await teamPaidSeats(tx, teamSide.id, teamPaymentCutoffAt(match.startsAt));
    return Math.max(0, teamSeats(teamSide) - paid) * teamSide.placeFeeCents;
  }

  private async readiness(tx: Prisma.TransactionClient, match: MeterMatch) {
    const otherSide = effectiveOtherSide(match.otherSideTakenBy, match.participants.length);
    const paid = async (side: TeamSide) => {
      const teamSide = match.teamSides.find((candidate) => candidate.side === side);
      return Boolean(teamSide?.teamId) && (await this.owedCents(tx, match, teamSide!)) === 0;
    };
    const homeFull = await paid('HOME');
    const otherReady = otherSide === 'TEAM'
      ? await paid('AWAY')
      : otherSide === 'INDIVIDUALS'
        ? match.formationSlots.length > 0 && match.formationSlots.every(({ participantId }) => participantId)
        : false;
    // Gate 8 (DEC-020, D2): the match also needs an active FootyFinder referee. D23: the teams' own reason first.
    const refereeReady = await hasActiveReferee(tx, match.id);
    const go = homeFull && otherReady && refereeReady;
    const reason: MatchCancellationReason | null = go
      ? null
      : otherSide === null
        ? 'NO_OPPONENT'
        : !homeFull || (otherSide === 'TEAM' && !otherReady)
          ? 'TEAM_UNPAID'
          : !otherReady
            ? 'POSITIONS_UNFILLED'
            : 'NO_REFEREE';
    return { go, reason, homeFull, otherReady, refereeReady };
  }

  private assertOpen(match: MeterMatch, now: Date) {
    if (!['OPEN', 'READY'].includes(match.status) || match.confirmedAt)
      throw new AppError(409, 'This match is no longer open.', 'MATCH_CLOSED');
    if (isLobbyFrozen(match, now) || now >= match.startsAt)
      throw new AppError(409, 'The lineup is locked 30 minutes before kickoff.', 'LINEUP_LOCKED');
  }

  private teamSide(match: MeterMatch, side: TeamSide) {
    const teamSide = match.teamSides.find((candidate) => candidate.side === side);
    if (!match.otherSideMode || !teamSide?.teamId || teamSide.teamFeeCents === null)
      throw new AppError(404, 'That side has no team.', 'TEAM_SIDE_NOT_FOUND');
    return teamSide;
  }

  private async load(tx: Prisma.TransactionClient, matchId: string) {
    const match = await tx.match.findUnique({ where: { id: matchId }, select: matchSelect });
    if (!match) throw new AppError(404, 'Match not found.', 'MATCH_NOT_FOUND');
    return match;
  }

  private async everyone(tx: Prisma.TransactionClient, match: MeterMatch) {
    const teamIds = match.teamSides.flatMap(({ teamId }) => (teamId ? [teamId] : []));
    const members = await tx.teamMembership.findMany({ where: { teamId: { in: teamIds } }, select: { userId: true } });
    return [...new Set([...members.map(({ userId }) => userId), ...match.participants.map(({ userId }) => userId)])];
  }
}
