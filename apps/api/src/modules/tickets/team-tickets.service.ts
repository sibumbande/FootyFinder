import { randomUUID } from 'node:crypto';
import {
  effectiveOtherSide,
  isLobbyFrozen,
  teamPaymentAlertAt,
  teamPaymentCutoffAt,
  ticketCancellationPolicy,
  ticketHoldExpiresAt,
  TICKET_REFERENCE_PREFIX,
  type TeamPaymentRoster,
  type TeamSide,
  type TeamTicketCheckoutInput,
  type TicketCheckoutResult,
} from '@footy-finder/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { emitDomainEventBestEffort } from '../../events/domain-events.js';
import { enqueueDurableJob } from '../../jobs/durable-jobs.js';
import { notificationDedupeKey, persistNotifications } from '../notifications/notification-writer.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { assertGirlsOnlyEligible } from '../matches/girls-only.js';
import { lockMatchForFormation } from '../matches/matches.repository.js';
import { assertNoPlayerOverlap, PlayerOverlapError, playerOverlapAppError } from '../matches/player-overlap.js';
import { playerAvatarUrl } from '../users/user.mapper.js';
import { isHiddenAccount } from '../users/hidden-account.js';
import { useOldestCreditInTx } from './match-credits.js';
import { enqueueTicketEmail } from './ticket-emails.js';
import { TICKET_HOLD_EXPIRE_JOB_TYPE, TicketCheckoutService } from './ticket-checkout.service.js';
import { refusal } from './ticket-placement.js';
import { notifyPlayersPaidFor, placeTeamTicketInTx, sideSelect, teamPaidSeats, teamSeats, type SideRecord } from './team-ticket-placement.js';
import { OnboardingService } from '../onboarding/onboarding.service.js';
import { demoDepositsEnabled } from '../wallet/payment-config.js';

type Tx = Prisma.TransactionClient;
const LINEUP = ['SELECTED_STARTER', 'OPEN_SLOT_CLAIMED', 'SELECTED_SUBSTITUTE'] as const;


/** Why a team's payments are closed right now (null when open). */
function paymentsClosedReason(teamSide: SideRecord, now: Date): TeamPaymentRoster['closedReason'] | null {
  const match = teamSide.match;
  if (!['OPEN', 'READY'].includes(match.status) || match.confirmedAt) return 'MATCH_CLOSED';
  if (now >= teamPaymentCutoffAt(match.startsAt) || isLobbyFrozen(match, now)) return 'CUTOFF_PASSED';
  // DEC-019 kept: the home team's places can be paid once the other side is taken.
  if (teamSide.side === 'HOME' && effectiveOtherSide(match.otherSideTakenBy, match.participants.length) === null) return 'OPPONENT_NOT_FOUND';
  return null;
}

/**
 * DEC-021 A5: a team match's places are paid as named match tickets. Any squad member can pay for teammates
 * (themselves included) on a named checklist; already-paid players show "Paid by …", players someone is paying for
 * right now show "Being paid for" (a 10-minute hold, like A1), so nobody pays twice; one Paystack transaction can
 * cover several players; a match credit pays only for the payer's own seat.
 */
export class TeamTicketsService {
  constructor(
    private readonly checkouts = new TicketCheckoutService(),
    private readonly notifications = new NotificationsService(),
    private readonly config: { demo: () => boolean; termsVersion: () => Promise<string | undefined> } = {
      demo: () => demoDepositsEnabled(),
      termsVersion: async () => (await new OnboardingService().currentLegalDocuments())[0]?.version,
    },
  ) {}

  private async loadSide(db: Tx | typeof prisma, matchId: string, side: TeamSide) {
    const teamSide = await db.matchTeam.findUnique({ where: { matchId_side: { matchId, side } }, select: sideSelect });
    if (!teamSide?.teamId || !teamSide.match.otherSideMode || teamSide.placeFeeCents === null)
      throw new AppError(404, 'That side has no team to pay for.', 'TEAM_SIDE_NOT_FOUND');
    return teamSide as SideRecord & { teamId: string; placeFeeCents: number };
  }

  async roster(matchId: string, side: TeamSide, viewerId: string, now = new Date()): Promise<TeamPaymentRoster> {
    const teamSide = await this.loadSide(prisma, matchId, side);
    const membership = await prisma.teamMembership.findUnique({ where: { teamId_userId: { teamId: teamSide.teamId, userId: viewerId } }, select: { role: true } });
    if (!membership) throw new AppError(403, "Only this team's members can see its payments.", 'TEAM_FORBIDDEN');
    const [members, selections, tickets, credits] = await Promise.all([
      prisma.teamMembership.findMany({
        where: { teamId: teamSide.teamId },
        select: { userId: true, user: { select: { username: true, accountStatus: true, profile: { select: { displayName: true, avatarUrl: true, photo: { select: { hiddenAt: true } } } } } } },
      }),
      prisma.teamMatchSelection.findMany({ where: { matchTeamId: teamSide.id, status: { in: [...LINEUP] } }, select: { userId: true, status: true, lineupSlot: { select: { id: true } } } }),
      prisma.matchTicket.findMany({
        where: { matchTeamId: teamSide.id, OR: [{ status: 'CONFIRMED' }, { status: 'HELD', holdExpiresAt: { gt: now } }] },
        select: { playerId: true, payerId: true, status: true, payer: { select: { username: true, profile: { select: { displayName: true } } } } },
      }),
      prisma.matchCredit.count({ where: { userId: viewerId, status: 'AVAILABLE', expiresAt: { gt: now } } }),
    ]);
    const role = (userId: string) => {
      const selection = selections.find((item) => item.userId === userId);
      return !selection ? null : selection.status === 'SELECTED_SUBSTITUTE' && !selection.lineupSlot ? ('SUBSTITUTE' as const) : ('STARTER' as const);
    };
    const order = { STARTER: 0, SUBSTITUTE: 1 } as const;
    const seats = teamSeats(teamSide);
    const paidSeats = await teamPaidSeats(prisma, teamSide.id, teamPaymentCutoffAt(teamSide.match.startsAt));
    const closedReason = paymentsClosedReason(teamSide, now);
    return {
      matchId,
      side,
      teamName: teamSide.teamNameSnapshot,
      seats,
      paidSeats,
      placeFeeCents: teamSide.placeFeeCents,
      stillNeededCents: Math.max(0, seats - paidSeats) * teamSide.placeFeeCents,
      alertAt: teamPaymentAlertAt(teamSide.match.startsAt).toISOString(),
      cutoffAt: teamPaymentCutoffAt(teamSide.match.startsAt).toISOString(),
      open: !closedReason,
      ...(closedReason ? { closedReason } : {}),
      viewerCreditsAvailable: credits,
      viewerCanManage: membership.role === 'OWNER' || membership.role === 'CAPTAIN',
      members: members
        .filter(({ user }) => !isHiddenAccount(user.accountStatus))
        .map(({ userId, user }) => {
          const ticket = tickets.find((item) => item.playerId === userId);
          return {
            userId,
            displayName: user.profile?.displayName ?? user.username,
            avatarUrl: playerAvatarUrl(userId, user.profile) ?? null,
            lineupRole: role(userId),
            status: !ticket ? ('UNPAID' as const) : ticket.status === 'CONFIRMED' ? ('PAID' as const) : ('BEING_PAID' as const),
            ...(ticket?.status === 'CONFIRMED' ? { paidByDisplayName: ticket.payer.profile?.displayName ?? ticket.payer.username, paidByMe: ticket.payerId === viewerId } : {}),
            isMe: userId === viewerId,
          };
        })
        .sort((a, b) =>
          (a.lineupRole ? order[a.lineupRole] : 2) - (b.lineupRole ? order[b.lineupRole] : 2)
          || (a.isMe === b.isMe ? 0 : a.isMe ? -1 : 1)
          || a.displayName.localeCompare(b.displayName)),
    };
  }

  /** A5: pays for the ticked teammates. A credit pays for the payer's own seat only. */
  async checkout(matchId: string, side: TeamSide, payerId: string, input: TeamTicketCheckoutInput, idempotencyKey: string, request: { ip?: string; userAgent?: string } = {}, now = new Date()): Promise<TicketCheckoutResult> {
    if (!idempotencyKey || idempotencyKey.length > 200)
      throw new AppError(400, 'A valid Idempotency-Key header is required.', 'IDEMPOTENCY_KEY_REQUIRED');
    const replay = await prisma.ticketCheckout.findUnique({ where: { payerId_idempotencyKey: { payerId, idempotencyKey } } });
    if (replay) return this.checkouts.result(replay.id);
    const playerIds = [...new Set(input.playerIds)];
    if (input.method === 'CREDIT' && (playerIds.length !== 1 || playerIds[0] !== payerId))
      throw new AppError(409, 'A match credit can only pay for your own place.', 'CREDIT_OWN_SEAT_ONLY');
    const termsVersion = await this.config.termsVersion();
    if (!termsVersion) throw new AppError(503, 'Approved legal documents are not yet available.', 'LEGAL_DOCUMENTS_UNAVAILABLE');
    const demo = this.config.demo();

    const outcome = await serializableTransaction(async (tx) => {
      await lockMatchForFormation(tx, matchId);
      const teamSide = await this.loadSide(tx, matchId, side);
      const payer = await tx.user.findUniqueOrThrow({ where: { id: payerId }, select: { bookingRestrictedAt: true } });
      if (payer.bookingRestrictedAt) throw refusal('BOOKING_RESTRICTED');
      if (!(await tx.teamMembership.findUnique({ where: { teamId_userId: { teamId: teamSide.teamId, userId: payerId } } })))
        throw new AppError(403, "Only this team's members can pay for its places.", 'TEAM_FORBIDDEN');
      const closed = paymentsClosedReason(teamSide, now);
      if (closed === 'OPPONENT_NOT_FOUND') throw new AppError(409, 'Payments open once the other side is taken.', 'TEAM_PAYMENTS_NOT_OPEN');
      if (closed) throw new AppError(409, 'Payments for this team closed 2 hours before kick-off.', 'TEAM_PAYMENTS_CLOSED');
      await tx.matchTicket.updateMany({ where: { matchTeamId: teamSide.id, status: 'HELD', holdExpiresAt: { lte: now } }, data: { status: 'RELEASED', releasedAt: now } });
      const members = await tx.teamMembership.findMany({ where: { teamId: teamSide.teamId, userId: { in: playerIds } }, select: { userId: true, user: { select: { accountStatus: true } } } });
      if (members.length !== playerIds.length || members.some(({ user }) => isHiddenAccount(user.accountStatus)))
        throw new AppError(409, 'You can only pay for current members of this team.', 'NOT_A_TEAM_MEMBER');
      const live = await tx.matchTicket.findMany({ where: { matchTeamId: teamSide.id, status: { in: ['CONFIRMED', 'HELD'] } }, select: { playerId: true, status: true } });
      if (live.some(({ playerId, status }) => status === 'CONFIRMED' && playerIds.includes(playerId)))
        throw new AppError(409, 'Someone you ticked is already paid for.', 'ALREADY_PAID');
      if (live.some(({ playerId, status }) => status === 'HELD' && playerIds.includes(playerId)))
        throw new AppError(409, 'Someone is paying for a player you ticked right now. Untick them, or try again in a few minutes.', 'BEING_PAID_FOR');
      const seats = teamSeats(teamSide);
      const free = seats - live.length;
      if (playerIds.length > free)
        throw new AppError(409, free > 0 ? `Only ${free} more ${free === 1 ? 'place is' : 'places are'} left to pay for.` : 'Every place in this team is already paid for.', 'TEAM_SEATS_FULL');
      await assertGirlsOnlyEligible(tx, teamSide.match, playerIds);
      try {
        for (const userId of playerIds) await assertNoPlayerOverlap(tx, userId, teamSide.match, userId === payerId);
      } catch (error) {
        if (error instanceof PlayerOverlapError) throw playerOverlapAppError(error);
        throw error;
      }
      const credit = input.method === 'CREDIT';
      const amountCents = credit ? 0 : teamSide.placeFeeCents * playerIds.length;
      const paymentId = credit ? null : randomUUID();
      if (paymentId)
        await tx.providerPayment.create({
          data: { id: paymentId, userId: payerId, purpose: 'TICKETS', provider: demo ? 'demo' : 'paystack', reference: `${TICKET_REFERENCE_PREFIX}${randomUUID().replaceAll('-', '')}`, amountCents },
        });
      const checkout = await tx.ticketCheckout.create({
        data: {
          matchId, payerId, kind: 'TEAM', method: credit ? 'CREDIT' : 'PAYMENT', providerPaymentId: paymentId, amountCents, idempotencyKey,
          policyAcceptedAt: now, termsVersion, policyText: ticketCancellationPolicy(teamSide.placeFeeCents).join('\n'),
          ipAddress: request.ip?.slice(0, 100) ?? null, userAgent: request.userAgent?.slice(0, 500) ?? null,
        },
      });
      const holdExpiresAt = ticketHoldExpiresAt(now);
      const tickets = [];
      for (const playerId of playerIds)
        tickets.push(await tx.matchTicket.create({
          data: {
            matchId, checkoutId: checkout.id, playerId, payerId, side, seat: 'TEAM', matchTeamId: teamSide.id,
            method: credit ? 'CREDIT' : 'PAYMENT', amountCents: credit ? 0 : teamSide.placeFeeCents, holdExpiresAt,
          },
        }));
      if (credit && !(await useOldestCreditInTx(tx, { userId: payerId, ticketId: tickets[0]!.id, now })))
        throw new AppError(409, 'You have no match credits to use.', 'NO_MATCH_CREDIT');
      if (credit || demo) {
        if (paymentId)
          await tx.providerPayment.update({ where: { id: paymentId }, data: { status: 'SUCCEEDED', verifiedAt: now, creditedBy: 'demo', providerStatus: 'success', channel: 'card' } });
        for (const ticket of tickets) {
          const placed = await placeTeamTicketInTx(tx, ticket.id, now);
          if (!placed.placed) throw new Error(`Team placement failed right after the checks passed: ${'reason' in placed ? placed.reason : ''}`);
        }
        await tx.ticketCheckout.update({ where: { id: checkout.id }, data: { status: 'COMPLETED', completedAt: now } });
        await enqueueTicketEmail(tx, { kind: 'RECEIPT', userId: payerId, checkoutId: checkout.id });
        return { checkoutId: checkout.id, needsPaystack: false, notifications: await notifyPlayersPaidFor(tx, checkout.id) };
      }
      await enqueueDurableJob(tx, { type: TICKET_HOLD_EXPIRE_JOB_TYPE, dedupeKey: `ticket-hold-expire:${checkout.id}`, payload: { checkoutId: checkout.id }, runAt: holdExpiresAt });
      return { checkoutId: checkout.id, needsPaystack: true, notifications: [] };
    });
    this.notifications.publishPersistedMany(outcome.notifications);
    emitDomainEventBestEffort('match:updated', { matchId });
    return outcome.needsPaystack ? this.checkouts.initializePaystack(outcome.checkoutId, payerId) : this.checkouts.result(outcome.checkoutId);
  }
}


