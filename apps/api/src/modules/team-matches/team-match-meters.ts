import {
  effectiveOtherSide,
  formatRandAmount,
  getGoNoGoAt,
  getTeamFee,
  isLobbyFrozen,
  type MatchCancellationReason,
  type TeamMeterView,
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
import { getFillReminderAt, FILL_REMINDER_MIN_LEAD_MINUTES } from '../matches/fill-reminder.js';
import { lockMatchForFormation, MatchesRepository } from '../matches/matches.repository.js';
import { notificationDedupeKey, persistNotifications } from '../notifications/notification-writer.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { TeamWalletInsufficientFundsError, TeamWalletRepository } from '../team-wallet/team-wallet.repository.js';
import { appendTeamMatchAudit } from './team-match-audit.js';
import { assertTeamMatchCommand } from './team-side-authority.js';
import { hasActiveReferee } from '../referees/referee-assignment.js';

/**
 * Gate 7 / TKT-709 (DEC-019 with D1, D2, D3, D5, D11): team fees, fill meters and the team T-30
 * go/no-go.
 * - Each team's fee is R80 x (starting positions + that team's subs), snapshotted on its side.
 * - Its meter is filled from its own team wallet by its owner/captains, as HOLDS (D2/D3): the
 *   money stays in the team wallet but cannot be spent, and is never over-filled.
 * - At T-30: the match goes ahead only if both meters are full (other side a team) or the home
 *   meter is full and every away starting position is claimed (other side individuals). Then every
 *   hold is captured once. Otherwise it is cancelled: every hold released, every individual's R80
 *   refunded, the reservation released, nothing owed to the venue, everyone notified.
 * - From T-30 nothing about money, subs or the other side can change (D11).
 */
export const TEAM_MATCH_GO_NO_GO_JOB_TYPE = 'TEAM_MATCH_GO_NO_GO';
export const TEAM_METER_REMINDER_JOB_TYPE = 'TEAM_METER_REMINDER';
export const teamGoNoGoDedupeKey = (matchId: string) => `team-match-go-no-go:${matchId}`;
export const teamMeterReminderDedupeKey = (matchId: string) => `team-meter-reminder:${matchId}`;

/** Scheduled in the transaction that publishes a team match, like the Quick Match check. */
export async function enqueueTeamGoNoGoJobs(tx: Prisma.TransactionClient, match: { id: string; startsAt: Date }, now = new Date()) {
  await enqueueDurableJob(tx, {
    type: TEAM_MATCH_GO_NO_GO_JOB_TYPE,
    dedupeKey: teamGoNoGoDedupeKey(match.id),
    payload: { matchId: match.id },
    runAt: getGoNoGoAt(match.startsAt),
  });
  if (match.startsAt.getTime() - now.getTime() > FILL_REMINDER_MIN_LEAD_MINUTES * 60_000)
    await enqueueDurableJob(tx, {
      type: TEAM_METER_REMINDER_JOB_TYPE,
      dedupeKey: teamMeterReminderDedupeKey(match.id),
      payload: { matchId: match.id },
      runAt: getFillReminderAt(match.startsAt),
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
      placeFeeCents: true, teamFeeCents: true,
    },
  },
} satisfies Prisma.MatchSelect;
type MeterMatch = Prisma.MatchGetPayload<{ select: typeof matchSelect }>;

export class TeamMatchMetersService {
  constructor(
    private readonly teamWallets = new TeamWalletRepository(),
    private readonly matches = new MatchesRepository(),
    private readonly notifications = new NotificationsService(),
  ) {}

  /** A team's own meter; only members of the team on that side may see it. */
  async meter(matchId: string, side: TeamSide, userId: string): Promise<TeamMeterView> {
    return serializableTransaction(async (tx) => {
      const match = await this.load(tx, matchId);
      const teamSide = this.teamSide(match, side);
      const membership = await tx.teamMembership.findUnique({
        where: { teamId_userId: { teamId: teamSide.teamId!, userId } },
        select: { role: true },
      });
      if (!membership) throw new AppError(403, "Only this team's members can see its meter.", 'TEAM_FORBIDDEN');
      return this.view(tx, match, side, membership.role === 'OWNER' || membership.role === 'CAPTAIN');
    });
  }

  /** D3: an owner/captain of this side moves team-wallet money into the meter (a hold). */
  async fill(matchId: string, side: TeamSide, userId: string, amountCents: number | undefined, idempotencyKey: string) {
    if (!idempotencyKey || idempotencyKey.length > 200)
      throw new AppError(400, 'A valid Idempotency-Key header is required.', 'IDEMPOTENCY_KEY_REQUIRED');
    const result = await serializableTransaction(async (tx) => {
      await lockMatchForFormation(tx, matchId);
      const match = await this.load(tx, matchId);
      const teamSide = this.teamSide(match, side);
      await assertTeamMatchCommand(tx, { matchId, userId, command: 'FILL_METER', side });
      const key = `team-meter:${teamSide.id}:${idempotencyKey}`;
      if (await tx.teamWalletHold.findUnique({ where: { idempotencyKey: key } }))
        return { view: await this.view(tx, match, side, true), replayed: true, teamId: teamSide.teamId! };
      this.assertOpen(match);
      if (!this.active(match, side))
        throw new AppError(409, 'The meter opens once the other side is taken.', 'TEAM_METER_NOT_ACTIVE');
      const account = await this.teamWallets.lockAccount(tx, teamSide.teamId!);
      const held = await this.sideMoney(tx, match.id, side, account.id);
      const remaining = teamSide.teamFeeCents! - held.held - held.captured;
      const amount = amountCents ?? remaining;
      if (remaining <= 0) throw new AppError(409, 'Your team meter is already full.', 'TEAM_METER_FULL');
      if (amount > remaining)
        throw new AppError(409, `Only ${formatRandAmount(remaining)} is left to fill.`, 'TEAM_METER_OVERFILL');
      try {
        await this.teamWallets.createHold(tx, {
          teamId: teamSide.teamId!, matchId, side, amountCents: amount, idempotencyKey: key, createdByUserId: userId,
        });
      } catch (error) {
        if (error instanceof TeamWalletInsufficientFundsError)
          throw new AppError(409, 'There is not enough available money in the team wallet. Ask members to add money to it.', 'TEAM_WALLET_INSUFFICIENT_FUNDS');
        throw error;
      }
      await appendTeamMatchAudit(tx, { matchId, command: 'METER_FILLED', teamId: teamSide.teamId, side, actorUserId: userId, payload: { amountCents: amount } });
      return { view: await this.view(tx, match, side, true), replayed: false, teamId: teamSide.teamId! };
    });
    if (!result.replayed) this.publish(matchId, result.teamId);
    return result;
  }

  /**
   * D5: a team changes its own subs until T-30. The fee is recalculated; money held above the new
   * fee is released at once. N4: the individuals side follows the home team's subs, but never
   * drops below the subs who have already joined; a team's lineup never has more subs than chosen.
   */
  async changeSubstitutes(matchId: string, side: TeamSide, userId: string, substituteCount: number) {
    const result = await serializableTransaction(async (tx) => {
      await lockMatchForFormation(tx, matchId);
      const match = await this.load(tx, matchId);
      const teamSide = this.teamSide(match, side);
      await assertTeamMatchCommand(tx, { matchId, userId, command: 'CHANGE_SUBSTITUTES', side });
      this.assertOpen(match);
      const selectedSubs = await tx.teamMatchSelection.count({ where: { matchTeamId: teamSide.id, status: 'SELECTED_SUBSTITUTE' } });
      if (substituteCount < selectedSubs)
        throw new AppError(409, `Your lineup already has ${selectedSubs} subs. Remove some before lowering the number.`, 'SUBSTITUTES_BELOW_SELECTED');
      const joinedIndividualSubs = Math.max(0, match.participants.length - teamSide.starterCount!);
      if (side === 'HOME' && match.otherSideTakenBy === 'INDIVIDUALS' && substituteCount < joinedIndividualSubs)
        throw new AppError(409, `${joinedIndividualSubs} subs have already joined the other side, so you can't go below that.`, 'SUBSTITUTES_BELOW_JOINED');
      const fee = getTeamFee(match.format, substituteCount);
      await tx.matchTeam.update({ where: { id: teamSide.id }, data: { substituteCount, teamFeeCents: fee.totalCents } });
      if (side === 'HOME') await tx.match.update({ where: { id: matchId }, data: { substituteCapacityPerTeam: substituteCount } });
      const account = await this.teamWallets.lockAccount(tx, teamSide.teamId!);
      const releasedCents = await this.releaseAbove(tx, match.id, side, account.id, fee.totalCents, userId);
      await appendTeamMatchAudit(tx, {
        matchId, command: 'SUBSTITUTES_CHANGED', teamId: teamSide.teamId, side, actorUserId: userId,
        payload: { from: teamSide.substituteCount, to: substituteCount, teamFeeCents: fee.totalCents, releasedCents },
      });
      return { view: await this.view(tx, await this.load(tx, matchId), side, true), teamId: teamSide.teamId!, releasedCents };
    });
    this.publish(matchId, result.teamId);
    return result;
  }

  /** D1: the team T-30 go/no-go. Idempotent under the Match row lock; safe to run late or twice. */
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
        const holds = await tx.teamWalletHold.findMany({
          where: { matchId, status: 'ACTIVE' },
          select: { id: true, account: { select: { teamId: true } } },
          orderBy: { createdAt: 'asc' },
        });
        await this.teamWallets.lockAccounts(tx, holds.map(({ account }) => account.teamId));
        for (const hold of holds)
          await this.teamWallets.captureHold(tx, hold.id, { idempotencyKey: `team-match-fee:${hold.id}`, description: `Team match fee: ${match.name}` });
        await tx.match.update({ where: { id: matchId }, data: { confirmedAt: now } });
        await appendTeamMatchAudit(tx, { matchId, command: 'TEAM_MATCH_CONFIRMED', payload: { capturedHolds: holds.length } });
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

  /** Two hours before kickoff: tell each team's owner/captains whose meter is not full yet. */
  async remindUnfilledMeters(matchId: string) {
    const notifications = await serializableTransaction(async (tx) => {
      await lockMatchForFormation(tx, matchId);
      const match = await tx.match.findUnique({ where: { id: matchId }, select: matchSelect });
      if (!match || !match.otherSideMode || match.confirmedAt || !['OPEN', 'READY'].includes(match.status)) return [] as Notification[];
      const drafts = [];
      for (const teamSide of match.teamSides) {
        if (!teamSide.teamId || !teamSide.teamFeeCents || !this.active(match, teamSide.side)) continue;
        const account = await tx.teamWalletAccount.findUnique({ where: { teamId: teamSide.teamId } });
        const { held } = account ? await this.sideMoney(tx, match.id, teamSide.side, account.id) : { held: 0 };
        if (held >= teamSide.teamFeeCents) continue;
        const managers = await tx.teamMembership.findMany({ where: { teamId: teamSide.teamId, role: { in: ['OWNER', 'CAPTAIN'] } }, select: { userId: true } });
        for (const { userId } of managers)
          drafts.push({
            userId,
            type: 'TEAM_METER_REMINDER' as const,
            title: 'Team meter not full yet',
            message: `${teamSide.teamNameSnapshot}'s meter is ${formatRandAmount(held)} / ${formatRandAmount(teamSide.teamFeeCents)}. Fill it from the team wallet by ${formatKickoffTime(match.goNoGoAt!)} or the match is cancelled.`,
            targetPath: `/matches/${matchId}`,
            dedupeKey: notificationDedupeKey('team-match', matchId, 'meter-reminder', teamSide.side, userId),
          });
      }
      return persistNotifications(tx, drafts);
    });
    this.notifications.publishPersistedMany(notifications);
    return notifications;
  }

  private async readiness(tx: Prisma.TransactionClient, match: MeterMatch) {
    const home = match.teamSides.find(({ side }) => side === 'HOME');
    const otherSide = effectiveOtherSide(match.otherSideTakenBy, match.participants.length);
    const full = async (side: TeamSide) => {
      const teamSide = match.teamSides.find((candidate) => candidate.side === side);
      if (!teamSide?.teamId || !teamSide.teamFeeCents) return false;
      const account = await tx.teamWalletAccount.findUnique({ where: { teamId: teamSide.teamId } });
      if (!account) return false;
      return (await this.sideMoney(tx, match.id, side, account.id)).held === teamSide.teamFeeCents;
    };
    const homeFull = Boolean(home) && (await full('HOME'));
    const otherReady = otherSide === 'TEAM'
      ? await full('AWAY')
      : otherSide === 'INDIVIDUALS'
        ? match.formationSlots.length > 0 && match.formationSlots.every(({ participantId }) => participantId)
        : false;
    // Gate 8 (DEC-020, D2): the match also needs an active FootyFinder referee. D23: the teams' own
    // reason comes first; 'no referee' is given only when that was the sole problem.
    const refereeReady = await hasActiveReferee(tx, match.id);
    const go = homeFull && otherReady && refereeReady;
    const reason: MatchCancellationReason | null = go
      ? null
      : otherSide === null
        ? 'NO_OPPONENT'
        : !homeFull || (otherSide === 'TEAM' && !otherReady)
          ? 'TEAM_FEES_UNFUNDED'
          : !otherReady
            ? 'POSITIONS_UNFILLED'
            : 'NO_REFEREE';
    return { go, reason, homeFull, otherReady, refereeReady };
  }

  /** Releases held money above `limit` (newest first); a partial hold is re-held for the rest. */
  private async releaseAbove(tx: Prisma.TransactionClient, matchId: string, side: TeamSide, accountId: string, limit: number, actorUserId: string) {
    const holds = await tx.teamWalletHold.findMany({
      where: { matchId, side, teamWalletAccountId: accountId, status: 'ACTIVE' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    let excess = holds.reduce((sum, hold) => sum + hold.amountCents, 0) - limit;
    let released = 0;
    const account = await tx.teamWalletAccount.findUniqueOrThrow({ where: { id: accountId } });
    for (const hold of holds) {
      if (excess <= 0) break;
      await this.teamWallets.releaseHold(tx, hold.id, 'subs-lowered');
      const keep = Math.max(0, hold.amountCents - excess);
      if (keep > 0)
        await this.teamWallets.createHold(tx, {
          teamId: account.teamId, matchId, side, amountCents: keep, idempotencyKey: `team-meter-rehold:${hold.id}`,
          createdByUserId: hold.createdByUserId ?? actorUserId,
        });
      released += hold.amountCents - keep;
      excess -= hold.amountCents - keep;
    }
    return released;
  }

  private async sideMoney(tx: Prisma.TransactionClient, matchId: string, side: TeamSide, accountId: string) {
    const rows = await tx.teamWalletHold.groupBy({
      by: ['status'],
      where: { matchId, side, teamWalletAccountId: accountId, status: { in: ['ACTIVE', 'CAPTURED'] } },
      _sum: { amountCents: true },
    });
    const sum = (status: string) => rows.find((row) => row.status === status)?._sum.amountCents ?? 0;
    return { held: sum('ACTIVE'), captured: sum('CAPTURED') };
  }

  private async view(tx: Prisma.TransactionClient, match: MeterMatch, side: TeamSide, canManage: boolean): Promise<TeamMeterView> {
    const teamSide = this.teamSide(match, side);
    const account = await this.teamWallets.summary(tx, teamSide.teamId!);
    const money = account.accountId ? await this.sideMoney(tx, match.id, side, account.accountId) : { held: 0, captured: 0 };
    const feeCents = teamSide.teamFeeCents!;
    return {
      matchId: match.id,
      side,
      teamId: teamSide.teamId!,
      teamName: teamSide.teamNameSnapshot,
      starterCount: teamSide.starterCount!,
      substituteCount: teamSide.substituteCount!,
      placeFeeCents: teamSide.placeFeeCents!,
      feeCents,
      heldCents: money.held,
      capturedCents: money.captured,
      remainingCents: Math.max(0, feeCents - money.held - money.captured),
      active: this.active(match, side),
      locked: isLobbyFrozen(match) || !['OPEN', 'READY'].includes(match.status),
      full: money.held + money.captured >= feeCents,
      viewerCanManage: canManage,
      ...(canManage && { teamWalletAvailableCents: account.availableCents }),
    };
  }

  private active(match: MeterMatch, side: TeamSide) {
    if (side === 'AWAY') return true;
    return effectiveOtherSide(match.otherSideTakenBy, match.participants.length) !== null;
  }

  private assertOpen(match: MeterMatch) {
    if (!['OPEN', 'READY'].includes(match.status) || match.confirmedAt)
      throw new AppError(409, 'This match is no longer open.', 'MATCH_CLOSED');
    if (isLobbyFrozen(match) || new Date() >= match.startsAt)
      throw new AppError(409, 'The lineup is locked 30 minutes before kickoff.', 'LINEUP_LOCKED');
  }

  private teamSide(match: MeterMatch, side: TeamSide) {
    const teamSide = match.teamSides.find((candidate) => candidate.side === side);
    if (!match.otherSideMode || !teamSide?.teamId || teamSide.teamFeeCents === null)
      throw new AppError(404, 'That team side has no meter.', 'TEAM_METER_NOT_FOUND');
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

  private publish(matchId: string, teamId: string) {
    emitDomainEventBestEffort('match:updated', { matchId });
    emitDomainEventBestEffort('team:wallet-updated', { teamId });
  }
}

