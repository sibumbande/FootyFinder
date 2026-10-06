import type { PaymentChannel } from '@footy-finder/shared';
import type { Notification, Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { emitDomainEventBestEffort } from '../../events/domain-events.js';
import { logInfo } from '../../observability/logger.js';
import { incrementOperationalMetric } from '../../observability/operational-metrics.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PaystackClient, PaystackError, type PaystackGateway, type PaystackVerifiedTransaction } from '../payments/paystack.client.js';
import { evaluateVerification, type SettlementSource } from '../payments/payment-verification.js';
import { enqueueTicketEmail } from './ticket-emails.js';
import { placeTicketInTx } from './ticket-placement.js';
import { notifyPlayersPaidFor, placeTeamTicketInTx } from './team-ticket-placement.js';
import { requestTicketRefundInTx } from './ticket-refunds.js';

/** A ticket payment Paystack has not confirmed within this long is closed (and a later success is refunded). */
export const TICKET_PAYMENT_MAX_PENDING_HOURS = 24;

/** Why a paid place could not be given, in the words the player sees (return page, email, ToS 13.3). */
const LATE_REASONS: Record<string, string> = {
  MATCH_CLOSED: 'The match was cancelled or closed before your payment came through.',
  LINEUP_LOCKED: 'Your payment came through after the lineup locked, 30 minutes before kick-off.',
  POSITION_ALREADY_CLAIMED: 'Someone else took that position while you were paying.',
  POSITION_BEING_BOOKED: 'Someone else was paying for that position when your payment came through.',
  SIDE_FULL: 'That side filled up while you were paying.',
  OTHER_SIDE_REFUSED: 'A team took that side of the match while you were paying.',
  ALREADY_IN_MATCH: 'You already had a place in this match, so this second payment is refunded.',
  PLAYER_MATCH_OVERLAP: 'You joined another match at the same time while you were paying.',
  // DEC-021 A5: team places.
  TEAM_PAYMENTS_CLOSED: 'Team payments closed 2 hours before kick-off, before your payment came through.',
  TEAM_WITHDRAWN: 'The team withdrew from the match before your payment came through.',
  NOT_IN_TEAM: 'The player is no longer in the team.',
};
const duplicateReasons = new Set(['ALREADY_IN_MATCH', 'SIDE_FULL']);
const lateReason = (code: string) => LATE_REASONS[code] ?? 'The place was no longer available when your payment came through.';

export type TicketSettlementResult = { status: string; outcome: 'PLACED' | 'REFUNDED' | 'FAIL' | 'WAIT' | 'REVIEW' | 'REPLAYED' };

/**
 * DEC-021 A1.3: the only path that turns a ticket payment into a place. The signed webhook, the hold-expiry job and
 * the player's status check all call it; each verifies with Paystack from our server (exact amount, ZAR, an offered
 * channel, our reference and metadata) and then, under the ProviderPayment row lock in a serializable transaction,
 * places the player. However they interleave, a payment is applied once. If the place or the match is gone by
 * then (a late payment, A1.4 / D5) the ticket is closed and refunded in full to the original method, with an email.
 */
export class TicketSettlementService {
  constructor(
    private readonly gateway: PaystackGateway = new PaystackClient(),
    private readonly notifications = new NotificationsService(),
    private readonly channels?: readonly PaymentChannel[],
  ) {}

  async settleFromVerify(reference: string, source: SettlementSource, options: { now?: Date; finalAttempt?: boolean } = {}): Promise<TicketSettlementResult> {
    const now = options.now ?? new Date();
    const payment = await prisma.providerPayment.findUnique({ where: { reference }, include: { checkout: { select: { id: true, matchId: true } } } });
    if (!payment || payment.purpose !== 'TICKETS' || !payment.checkout)
      throw Object.assign(new Error('Unknown ticket payment reference.'), { code: 'TICKET_PAYMENT_NOT_FOUND' });
    if (payment.status === 'SUCCEEDED' || payment.status === 'REVIEW') return { status: payment.status, outcome: 'REPLAYED' };

    let verified: PaystackVerifiedTransaction | null;
    try {
      verified = await this.gateway.verify(reference);
    } catch (error) {
      if (!(error instanceof PaystackError) || error.code !== 'PAYSTACK_NOT_FOUND') throw error;
      verified = null;
    }
    const finalAttempt = options.finalAttempt ?? now.getTime() - payment.createdAt.getTime() >= TICKET_PAYMENT_MAX_PENDING_HOURS * 3_600_000;
    const outcome = evaluateVerification(payment, verified, { finalAttempt, channels: this.channels });
    const checkoutId = payment.checkout.id;

    const result = await serializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ProviderPayment" WHERE "id" = ${payment.id}::uuid FOR UPDATE`;
      const current = await tx.providerPayment.findUniqueOrThrow({ where: { id: payment.id } });
      const observed: Prisma.ProviderPaymentUpdateInput = {
        lastVerifiedAt: now,
        ...(verified && { providerStatus: verified.status.slice(0, 40), providerTransactionId: verified.id || undefined, channel: verified.channel?.slice(0, 40) }),
      };
      const notifications: Notification[] = [];
      if (current.status === 'SUCCEEDED' || current.status === 'REVIEW') return { status: current.status, outcome: 'REPLAYED' as const, notifications };
      // A payment we had closed that Paystack now reports as paid is still money received for a ticket: it is
      // applied like any late payment (placed if the place is still free, otherwise refunded in full).
      if (current.status === 'FAILED' && outcome.kind !== 'CREDIT') return { status: current.status, outcome: 'REPLAYED' as const, notifications };
      if (outcome.kind === 'REVIEW') {
        await tx.providerPayment.update({ where: { id: current.id }, data: { ...observed, status: 'REVIEW', reviewReason: outcome.reason } });
        return { status: 'REVIEW', outcome: 'REVIEW' as const, notifications };
      }
      if (outcome.kind === 'FAIL') {
        await tx.providerPayment.update({ where: { id: current.id }, data: { ...observed, status: 'FAILED', failureReason: outcome.reason } });
        await tx.ticketCheckout.updateMany({ where: { id: checkoutId, status: { in: ['PENDING', 'EXPIRED'] } }, data: { status: 'FAILED' } });
        await tx.matchTicket.updateMany({ where: { checkoutId, status: 'HELD' }, data: { status: 'RELEASED', releasedAt: now } });
        return { status: 'FAILED', outcome: 'FAIL' as const, notifications };
      }
      if (outcome.kind === 'WAIT') {
        await tx.providerPayment.update({ where: { id: current.id }, data: observed });
        return { status: current.status, outcome: 'WAIT' as const, notifications };
      }

      // Verified paid: apply it to every ticket in the checkout.
      await tx.providerPayment.update({
        where: { id: current.id },
        data: { ...observed, status: 'SUCCEEDED', verifiedAt: now, creditedBy: source, failureReason: null },
      });
      const tickets = await tx.matchTicket.findMany({ where: { checkoutId }, orderBy: { createdAt: 'asc' } });
      let placed = 0;
      let refunded = 0;
      for (const ticket of tickets) {
        if (ticket.status === 'CONFIRMED') {
          placed += 1;
          continue;
        }
        if (!['HELD', 'RELEASED'].includes(ticket.status)) continue;
        const placement = ticket.seat === 'TEAM' ? await placeTeamTicketInTx(tx, ticket.id, now) : await placeTicketInTx(tx, ticket.id, now);
        if (placement.placed) {
          placed += 1;
          notifications.push(...placement.notifications);
          continue;
        }
        const reason = 'reason' in placement ? placement.reason : 'NOT_PLACEABLE';
        // A5: a team place already paid for (or no place left) is the "double payment that slips through".
        const duplicate = ticket.seat === 'TEAM' ? duplicateReasons.has(reason) : reason === 'ALREADY_IN_MATCH';
        const closedReason = lateReason(reason);
        await tx.matchTicket.update({
          where: { id: ticket.id },
          data: { status: 'CLOSED', closedAt: now, outcome: duplicate ? 'DUPLICATE_REFUNDED' : 'LATE_PAYMENT_REFUNDED', closedReason, releasedAt: ticket.releasedAt ?? now },
        });
        await requestTicketRefundInTx(tx, { ticketId: ticket.id, source: duplicate ? 'DUPLICATE_PAYMENT' : 'LATE_PAYMENT', reason: closedReason, initiatedByUserId: ticket.payerId });
        refunded += 1;
      }
      if (placed) {
        await tx.ticketCheckout.update({ where: { id: checkoutId }, data: { status: 'COMPLETED', completedAt: now } });
        notifications.push(...(await notifyPlayersPaidFor(tx, checkoutId)));
        await enqueueTicketEmail(tx, { kind: 'RECEIPT', userId: current.userId, checkoutId });
      } else await tx.ticketCheckout.updateMany({ where: { id: checkoutId, status: 'PENDING' }, data: { status: 'EXPIRED' } });
      if (refunded) await enqueueTicketEmail(tx, { kind: 'LATE_PAYMENT_REFUND', userId: current.userId, checkoutId });
      return { status: 'SUCCEEDED', outcome: placed ? ('PLACED' as const) : ('REFUNDED' as const), notifications };
    });

    this.notifications.publishPersistedMany(result.notifications);
    if (result.outcome === 'PLACED' || result.outcome === 'REFUNDED') emitDomainEventBestEffort('match:updated', { matchId: payment.checkout.matchId });
    if (result.outcome === 'REFUNDED') incrementOperationalMetric('ticket_late_payment_refunds_total');
    logInfo('ticket_settlement', { source, outcome: result.outcome, paymentId: payment.id });
    return { status: result.status, outcome: result.outcome };
  }
}
