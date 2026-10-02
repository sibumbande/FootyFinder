import { ticketLeaveOutcome } from '@footy-finder/shared';
import type { MatchTicketOutcome, Notification, Prisma } from '../../generated/prisma/client.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { emitDomainEventBestEffort } from '../../events/domain-events.js';
import { notificationDedupeKey, persistNotifications } from '../notifications/notification-writer.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { reversePromotionalCosts } from '../matches/free-matches.js';
import { assertLobbyOpen, bumpFormationVersion, LineupLockedError, lockMatchForFormation, MatchClosedError } from '../matches/matches.repository.js';
import { issueCreditInTx, returnCreditForTicketInTx } from './match-credits.js';
import { requestTicketRefundInTx } from './ticket-refunds.js';
import { refusal } from './ticket-placement.js';

export type TicketChoice = 'CREDIT' | 'REFUND';

const LEFT_MESSAGE: Record<MatchTicketOutcome, string> = {
  CREDIT_ISSUED: 'You left the match. 1 match credit was added to your account: use it on any match within 3 years.',
  REFUNDED: 'You left the match. Your refund is on its way to the card or bank account you paid with.',
  CREDIT_RETURNED: 'You left the match. Your match credit was returned to you.',
  FORFEITED: 'You left the match less than 24 hours before kick-off, so nothing is refunded. Your place was released for someone else.',
  NOTHING_DUE: 'You left the free match. Nothing was paid, so nothing is refunded.',
  LATE_PAYMENT_REFUNDED: 'You left the match.',
  DUPLICATE_REFUNDED: 'You left the match.',
};

/**
 * DEC-021 A2: leaving a match with a ticket, and A3: choosing what a cancelled match gives back.
 * - More than 24 hours before kick-off the player chooses 1 match credit (the recommended option) or a refund of
 *   the ticket price to the card or bank account it was paid with. A credit-paid ticket returns its credit.
 * - 24 hours or less before kick-off: no refund and no credit; the place is released for someone else.
 * - From the T-30 lock nobody can leave (unchanged).
 * The credit or refund always goes to whoever paid for the place.
 */
export class TicketLeaveService {
  constructor(private readonly notifications = new NotificationsService()) {}

  async leave(matchId: string, userId: string, choice: TicketChoice | undefined, now = new Date()) {
    const result = await serializableTransaction(async (tx) => {
      await lockMatchForFormation(tx, matchId);
      const match = await tx.match.findUnique({
        where: { id: matchId },
        select: { id: true, mode: true, status: true, startsAt: true, durationMinutes: true, goNoGoAt: true, otherSideMode: true, name: true },
      });
      if (!match) throw new AppError(404, 'Match not found.', 'MATCH_NOT_FOUND');
      const ticket = await tx.matchTicket.findFirst({ where: { matchId, playerId: userId, status: 'CONFIRMED' } });
      if (!ticket || !ticket.participantId) throw new AppError(409, 'You do not have a place in this match.', 'NOT_IN_MATCH');
      if (ticket.seat === 'TEAM') throw new AppError(409, 'Team places are left from the team lineup.', 'TEAM_SEAT');
      try {
        assertLobbyOpen(match, now);
      } catch (error) {
        if (error instanceof LineupLockedError) throw refusal('LINEUP_LOCKED');
        if (error instanceof MatchClosedError) throw refusal('MATCH_CLOSED');
        throw error;
      }
      const timing = ticketLeaveOutcome(match.startsAt, now);
      if (ticket.method === 'PAYMENT' && timing === 'CHOICE' && !choice)
        throw new AppError(400, 'Choose a match credit or a refund.', 'TICKET_CHOICE_REQUIRED');

      const released = await tx.formationSlot.updateMany({ where: { participantId: ticket.participantId }, data: { participantId: null } });
      if (released.count) await bumpFormationVersion(tx, matchId);
      await tx.matchParticipant.update({ where: { id: ticket.participantId }, data: { status: 'LEFT', leftAt: now } });
      await reversePromotionalCosts(tx, { participantId: ticket.participantId }, 'PLAYER_LEFT', now);

      let outcome: MatchTicketOutcome;
      if (ticket.method === 'FREE') outcome = 'NOTHING_DUE';
      else if (timing === 'NOTHING') outcome = 'FORFEITED';
      else if (ticket.method === 'CREDIT') {
        await returnCreditForTicketInTx(tx, ticket.id, now);
        outcome = 'CREDIT_RETURNED';
      } else if (choice === 'CREDIT') {
        await issueCreditInTx(tx, { userId: ticket.payerId, reason: 'LEFT_MATCH', sourceTicketId: ticket.id, originTicketId: ticket.id, now });
        outcome = 'CREDIT_ISSUED';
      } else {
        await requestTicketRefundInTx(tx, { ticketId: ticket.id, source: 'TICKET_LEFT', reason: 'Left the match more than 24 hours before kick-off', initiatedByUserId: ticket.payerId });
        outcome = 'REFUNDED';
      }
      await tx.matchTicket.update({
        where: { id: ticket.id },
        data: { status: 'CLOSED', closedAt: now, outcome, participantId: null, closedReason: 'Left the match' },
      });
      const notifications = await persistNotifications(tx, [
        {
          userId,
          type: 'PLAYER_CANCELLED',
          title: 'You left the match',
          message: LEFT_MESSAGE[outcome],
          targetPath: `/matches/${matchId}`,
          dedupeKey: notificationDedupeKey('ticket', ticket.id, 'left', userId),
        },
      ]);
      return { outcome, notifications };
    });
    this.notifications.publishPersistedMany(result.notifications);
    emitDomainEventBestEffort('participant:left', { matchId, userId });
    emitDomainEventBestEffort('match:updated', { matchId });
    return { outcome: result.outcome };
  }

  /**
   * A3: the payer chooses, for their places in a cancelled match, 1 match credit each or a full refund to the
   * original payment method. `ticketIds` limits it to some places; without it the choice applies to all of them.
   */
  async choose(payerId: string, matchId: string, choice: TicketChoice, ticketIds?: string[], now = new Date()) {
    const result = await serializableTransaction(async (tx) => {
      const tickets = await tx.matchTicket.findMany({
        where: { matchId, payerId, status: 'CHOICE_PENDING', ...(ticketIds?.length ? { id: { in: ticketIds } } : {}) },
      });
      if (!tickets.length) throw new AppError(409, 'There is nothing to choose for this match.', 'NO_CHOICE_PENDING');
      for (const ticket of tickets) await this.resolveInTx(tx, ticket.id, choice, choice === 'REFUND' ? 'MATCH_CANCELLED' : null, now);
      const notifications: Notification[] = await persistNotifications(tx, [
        {
          userId: payerId,
          type: 'INFO',
          title: choice === 'CREDIT' ? 'Match credit added' : 'Refund on its way',
          message: choice === 'CREDIT'
            ? `${tickets.length === 1 ? '1 match credit was' : `${tickets.length} match credits were`} added to your account. Use ${tickets.length === 1 ? 'it' : 'them'} on any match within 3 years.`
            : 'Your refund is on its way to the card or bank account you paid with.',
          targetPath: `/matches/${matchId}`,
          dedupeKey: notificationDedupeKey('match', matchId, `choice-${choice}-${tickets.map(({ id }) => id).sort().join('.')}`, payerId),
        },
      ]);
      return { count: tickets.length, notifications };
    });
    this.notifications.publishPersistedMany(result.notifications);
    return { resolved: result.count, choice };
  }

  /** A3: no choice within 7 days: refunded automatically to the original method (never a silent credit). */
  async autoRefund(ticketId: string, now = new Date()) {
    await serializableTransaction(async (tx) => {
      const ticket = await tx.matchTicket.findUnique({ where: { id: ticketId } });
      if (!ticket || ticket.status !== 'CHOICE_PENDING') return;
      if (ticket.choiceDeadlineAt && ticket.choiceDeadlineAt > now)
        throw Object.assign(new Error('The choice deadline has not passed yet.'), { code: 'TICKET_CHOICE_NOT_DUE' });
      await this.resolveInTx(tx, ticket.id, 'REFUND', 'CHOICE_TIMEOUT', now);
    });
  }

  private async resolveInTx(tx: Prisma.TransactionClient, ticketId: string, choice: TicketChoice, source: 'MATCH_CANCELLED' | 'CHOICE_TIMEOUT' | null, now: Date) {
    const ticket = await tx.matchTicket.findUniqueOrThrow({ where: { id: ticketId } });
    if (ticket.status !== 'CHOICE_PENDING') return;
    if (choice === 'CREDIT') await issueCreditInTx(tx, { userId: ticket.payerId, reason: 'MATCH_CANCELLED', sourceTicketId: ticket.id, originTicketId: ticket.id, now });
    else
      await requestTicketRefundInTx(tx, {
        ticketId: ticket.id,
        source: source ?? 'MATCH_CANCELLED',
        reason: source === 'CHOICE_TIMEOUT' ? 'Match cancelled: no choice within 7 days, refunded automatically' : 'Match cancelled: the payer chose a refund',
        initiatedByUserId: ticket.payerId,
      });
    await tx.matchTicket.update({
      where: { id: ticket.id },
      data: { status: 'CLOSED', closedAt: now, outcome: choice === 'CREDIT' ? 'CREDIT_ISSUED' : 'REFUNDED', closedReason: source === 'CHOICE_TIMEOUT' ? 'No choice within 7 days' : 'Match cancelled' },
    });
  }
}
