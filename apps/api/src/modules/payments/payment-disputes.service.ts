import type { AdminPaymentDispute, EvidenceAttendance, PaymentDisputeEvidencePack } from '@footy-finder/shared';
import type { Notification, Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { incrementOperationalMetric } from '../../observability/operational-metrics.js';
import { appendAdminAudit } from '../admin/admin-audit.js';
import { notificationDedupeKey, persistNotifications } from '../notifications/notification-writer.js';
import { NotificationsService } from '../notifications/notifications.service.js';

const rands = (cents: number) => `R${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const iso = (value: Date | null | undefined) => value?.toISOString();

/** D9: while any dispute is open the payer is restricted; after a lost one the restriction stays until an admin lifts it. */
export const DISPUTE_OPEN_REASON = 'PAYMENT_DISPUTE_OPEN';
export const DISPUTE_LOST_REASON = 'PAYMENT_DISPUTE_LOST';

/**
 * Maps Paystack's dispute resolution to our outcome. "declined" means the merchant declined the
 * chargeback and kept the money (we won); an "accepted" resolution means the cardholder won.
 */
export const disputeOutcome = (resolution: unknown): 'WON' | 'LOST' | null => {
  const value = String(resolution ?? '').toLowerCase();
  if (value.includes('declined')) return 'WON';
  if (value.includes('accepted')) return 'LOST';
  return null;
};

const disputeInclude = {
  providerPayment: {
    include: {
      user: { select: { id: true, username: true, bookingRestrictedAt: true, bookingRestrictionReason: true, profile: { select: { displayName: true } } } },
      checkout: { include: { match: { select: { name: true, startsAt: true } }, _count: { select: { tickets: true } } } },
    },
  },
} satisfies Prisma.ProviderDisputeInclude;
type DisputeRow = Prisma.ProviderDisputeGetPayload<{ include: typeof disputeInclude }>;

const toAdminDispute = (row: DisputeRow): AdminPaymentDispute => {
  const payment = row.providerPayment;
  return {
    id: row.id,
    providerDisputeId: row.providerDisputeId,
    status: row.status,
    amountCents: row.amountCents,
    reference: payment.reference,
    purpose: payment.purpose,
    payer: {
      userId: payment.user.id,
      username: payment.user.username,
      displayName: payment.user.profile?.displayName ?? undefined,
      bookingRestrictedAt: iso(payment.user.bookingRestrictedAt),
      bookingRestrictionReason: payment.user.bookingRestrictionReason ?? undefined,
    },
    ticketCount: payment.checkout?._count.tickets ?? 0,
    matchName: payment.checkout?.match.name,
    matchStartsAt: iso(payment.checkout?.match.startsAt),
    openedAt: row.openedAt.toISOString(),
    dueAt: iso(row.dueAt),
    resolvedAt: iso(row.resolvedAt),
    resolution: row.resolution ?? undefined,
  };
};

/**
 * DEC-021 A8 / D9: payment disputes (chargebacks). Nothing is reversed from anyone and no balance goes negative:
 * - charge.dispute.create records the dispute and restricts the payer from buying tickets or using match credits.
 *   Tickets in that payment stay valid, so teammates who didn't dispute aren't punished. We contest with the
 *   evidence pack.
 * - charge.dispute.resolve: won lifts the restriction by itself (when nothing else is open or lost); lost keeps
 *   it until an admin lifts it (reason, fresh MFA, audited).
 */
export class PaymentDisputesService {
  constructor(private readonly notifications = new NotificationsService()) {}

  async open(reference: string | null, data: Record<string, unknown>) {
    const disputeId = data.id === undefined ? '' : String(data.id);
    if (!reference || !disputeId) return 'dispute_missing_identifiers';
    const payment = await prisma.providerPayment.findUnique({ where: { reference }, include: { refunds: true } });
    if (!payment) return 'dispute_unknown_reference';
    if (payment.status !== 'SUCCEEDED') return 'dispute_on_unconfirmed_payment';
    const refunded = payment.refunds
      .filter((refund) => !['FAILED', 'RESTORED_TO_WALLET'].includes(refund.status))
      .reduce((sum, refund) => sum + refund.amountCents, 0);
    const requested = Number(data.refund_amount ?? record(data.transaction).amount ?? payment.amountCents);
    const amountCents = Math.min(Number.isFinite(requested) && requested > 0 ? requested : payment.amountCents, payment.amountCents);
    const dueAt = typeof data.due_at === 'string' && !Number.isNaN(Date.parse(data.due_at)) ? new Date(data.due_at) : null;

    const result = await serializableTransaction(async (tx) => {
      const existing = await tx.providerDispute.findUnique({ where: { providerDisputeId: disputeId } });
      if (existing) return { outcome: 'dispute_replayed', notifications: [] as Notification[] };
      await tx.providerDispute.create({ data: { providerPaymentId: payment.id, providerDisputeId: disputeId, amountCents, dueAt } });
      const user = await tx.user.findUniqueOrThrow({ where: { id: payment.userId }, select: { bookingRestrictedAt: true, bookingRestrictionReason: true } });
      await tx.user.update({
        where: { id: payment.userId },
        data: {
          bookingRestrictedAt: user.bookingRestrictedAt ?? new Date(),
          bookingRestrictionReason: user.bookingRestrictionReason === DISPUTE_LOST_REASON ? DISPUTE_LOST_REASON : DISPUTE_OPEN_REASON,
        },
      });
      return {
        outcome: refunded >= payment.amountCents ? 'dispute_opened_after_refund' : 'dispute_opened',
        notifications: await persistNotifications(tx, [
          {
            userId: payment.userId,
            type: 'PAYMENT_DISPUTE_OPENED',
            title: 'Payment disputed with your bank',
            message: `Your bank disputed a ${rands(amountCents)} FootyFinder payment. Until this is resolved you can’t buy match tickets or use match credits. Tickets you already have stay valid.`,
            targetPath: '/support',
            dedupeKey: notificationDedupeKey('provider-dispute', disputeId, 'opened', payment.userId),
          },
        ]),
      };
    });
    this.notifications.publishPersistedMany(result.notifications);
    if (result.outcome !== 'dispute_replayed') incrementOperationalMetric('card_chargeback_opened_total');
    return result.outcome;
  }

  async resolve(data: Record<string, unknown>) {
    const disputeId = data.id === undefined ? '' : String(data.id);
    const dispute = disputeId
      ? await prisma.providerDispute.findUnique({ where: { providerDisputeId: disputeId }, include: { providerPayment: true } })
      : null;
    if (!dispute) return 'dispute_unknown';
    const outcome = disputeOutcome(data.resolution);
    if (!outcome) return 'dispute_resolution_unknown';
    const result = await serializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ProviderDispute" WHERE "id" = ${dispute.id}::uuid FOR UPDATE`;
      const current = await tx.providerDispute.findUniqueOrThrow({ where: { id: dispute.id } });
      if (current.status !== 'OPEN') return { outcome: 'dispute_replayed', notifications: [] as Notification[] };
      const userId = dispute.providerPayment.userId;
      await tx.providerDispute.update({
        where: { id: current.id },
        data: { status: outcome, resolvedAt: new Date(), resolution: String(data.resolution).slice(0, 80) },
      });
      const lifted = await this.refreshRestriction(tx, userId, outcome);
      return {
        outcome: outcome === 'WON' ? 'dispute_won' : 'dispute_lost',
        notifications: await persistNotifications(tx, [
          {
            userId,
            type: 'INFO',
            title: 'Payment dispute resolved',
            message: lifted
              ? 'The dispute about your payment was resolved. You can buy match tickets and use match credits again.'
              : outcome === 'WON'
                ? 'The dispute about your payment was resolved.'
                : 'The dispute about your payment was resolved in your bank’s favour. Contact support to book again.',
            targetPath: '/support',
            dedupeKey: notificationDedupeKey('provider-dispute', current.providerDisputeId, 'resolved', userId),
          },
        ]),
      };
    });
    this.notifications.publishPersistedMany(result.notifications);
    return result.outcome;
  }

  /** Returns true when the restriction was lifted (won, nothing else open, never lost). */
  private async refreshRestriction(tx: Prisma.TransactionClient, userId: string, outcome: 'WON' | 'LOST') {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { bookingRestrictedAt: true, bookingRestrictionReason: true } });
    if (outcome === 'LOST') {
      await tx.user.update({ where: { id: userId }, data: { bookingRestrictedAt: user.bookingRestrictedAt ?? new Date(), bookingRestrictionReason: DISPUTE_LOST_REASON } });
      return false;
    }
    const stillOpen = await tx.providerDispute.count({ where: { status: 'OPEN', providerPayment: { userId } } });
    if (stillOpen || user.bookingRestrictionReason !== DISPUTE_OPEN_REASON || !user.bookingRestrictedAt) return false;
    await tx.user.update({ where: { id: userId }, data: { bookingRestrictedAt: null, bookingRestrictionReason: null } });
    return true;
  }

  /** Admin "Payment disputes": open ones first (soonest evidence deadline), then the latest resolved. */
  async list(): Promise<AdminPaymentDispute[]> {
    const rows = await prisma.providerDispute.findMany({ include: disputeInclude, orderBy: [{ openedAt: 'desc' }], take: 200 });
    const rank = (row: DisputeRow) => (row.status === 'OPEN' ? 0 : 1);
    return rows
      .sort((a, b) => rank(a) - rank(b) || (a.status === 'OPEN' ? (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity) : 0))
      .map(toAdminDispute);
  }

  /**
   * A8: the evidence pack. The ticket(s) and match(es), the policy the payer accepted (time, Terms version, wording,
   * IP address and browser), the emails we sent, whether each player played (the referee's lineup record), and the
   * cancellation, refund and credit history.
   */
  async evidence(disputeId: string, now = new Date()): Promise<PaymentDisputeEvidencePack> {
    const row = await prisma.providerDispute.findUnique({ where: { id: disputeId }, include: disputeInclude });
    if (!row) throw new AppError(404, 'Payment dispute not found.', 'PAYMENT_DISPUTE_NOT_FOUND');
    const payment = await prisma.providerPayment.findUniqueOrThrow({
      where: { id: row.providerPaymentId },
      include: {
        user: { select: { id: true, username: true, email: true, profile: { select: { displayName: true } } } },
        refunds: { orderBy: { createdAt: 'asc' } },
        checkout: {
          include: {
            tickets: {
              orderBy: { createdAt: 'asc' },
              include: {
                player: { select: { username: true, profile: { select: { displayName: true } } } },
                match: { include: { venue: { select: { name: true } } } },
                creditEvents: { orderBy: { createdAt: 'asc' } },
              },
            },
          },
        },
      },
    });
    const checkout = payment.checkout;
    const tickets = checkout?.tickets ?? [];
    const ticketIds = tickets.map(({ id }) => id);
    const [lineup, emails] = await Promise.all([
      prisma.matchLineupEntry.findMany({
        where: { OR: tickets.map((ticket) => ({ matchId: ticket.matchId, userId: ticket.playerId })) },
        select: { matchId: true, userId: true, didNotPlay: true },
      }),
      checkout
        ? prisma.ticketEmail.findMany({
            where: { OR: [{ checkoutId: checkout.id }, { ticketId: { in: ticketIds } }] },
            orderBy: { sentAt: 'asc' },
            include: { user: { select: { username: true, profile: { select: { displayName: true } } } } },
          })
        : Promise.resolve([]),
    ]);
    const attendance = (ticket: (typeof tickets)[number]): EvidenceAttendance => {
      if (ticket.match.status === 'CANCELLED') return 'MATCH_NOT_PLAYED';
      const entry = lineup.find((item) => item.matchId === ticket.matchId && item.userId === ticket.playerId);
      if (!entry) return 'NOT_RECORDED';
      return entry.didNotPlay ? 'DID_NOT_PLAY' : 'PLAYED';
    };
    const name = (user: { username: string; profile: { displayName: string } | null }) => user.profile?.displayName ?? user.username;
    return {
      generatedAt: now.toISOString(),
      dispute: toAdminDispute(row),
      payment: {
        reference: payment.reference,
        amountCents: payment.amountCents,
        currency: payment.currency,
        channel: payment.channel ?? undefined,
        createdAt: payment.createdAt.toISOString(),
        verifiedAt: iso(payment.verifiedAt),
        confirmedBy: payment.creditedBy ?? undefined,
      },
      payer: { userId: payment.user.id, username: payment.user.username, displayName: payment.user.profile?.displayName ?? undefined, email: payment.user.email },
      policyAcceptance: checkout
        ? {
            acceptedAt: checkout.policyAcceptedAt.toISOString(),
            termsVersion: checkout.termsVersion,
            policyText: checkout.policyText,
            ipAddress: checkout.ipAddress ?? undefined,
            userAgent: checkout.userAgent ?? undefined,
          }
        : undefined,
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        playerDisplayName: name(ticket.player),
        seat: ticket.seat,
        side: ticket.side,
        status: ticket.status,
        outcome: ticket.outcome ?? undefined,
        amountCents: ticket.amountCents,
        confirmedAt: iso(ticket.confirmedAt),
        closedAt: iso(ticket.closedAt),
        closedReason: ticket.closedReason ?? undefined,
        attendance: attendance(ticket),
        match: {
          id: ticket.match.id,
          name: ticket.match.name,
          venueName: ticket.match.venue.name,
          startsAt: ticket.match.startsAt.toISOString(),
          status: ticket.match.status,
          cancelledAt: iso(ticket.match.cancelledAt),
          cancellationReason: ticket.match.cancellationReason ?? undefined,
        },
      })),
      emails: emails.map((email) => ({ kind: email.kind, subject: email.subject, sentAt: email.sentAt.toISOString(), recipientDisplayName: name(email.user) })),
      refunds: payment.refunds.map((refund) => ({
        id: refund.id,
        amountCents: refund.amountCents,
        status: refund.status,
        source: refund.source,
        reason: refund.reason,
        createdAt: refund.createdAt.toISOString(),
        processedAt: iso(refund.processedAt),
      })),
      creditEvents: tickets.flatMap((ticket) => ticket.creditEvents.map((event) => ({ ticketId: ticket.id, type: event.type, at: event.createdAt.toISOString() }))),
    };
  }

  /** D9: after a lost dispute (or once nothing is open) an admin lifts the booking restriction. Reason, fresh MFA, audited. */
  async liftRestriction(input: { actorUserId: string; userId: string; reason: string; requestId?: string }) {
    if (!input.reason.trim()) throw new AppError(400, 'A reason is required.', 'REASON_REQUIRED');
    return serializableTransaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: input.userId }, select: { bookingRestrictedAt: true, bookingRestrictionReason: true } });
      if (!user) throw new AppError(404, 'User not found.', 'USER_NOT_FOUND');
      if (!user.bookingRestrictedAt) return { changed: false };
      const openDisputes = await tx.providerDispute.count({ where: { status: 'OPEN', providerPayment: { userId: input.userId } } });
      if (openDisputes) throw new AppError(409, 'A payment dispute is still open. The restriction lifts by itself if it is resolved in our favour.', 'PAYMENT_DISPUTE_OPEN');
      await tx.user.update({ where: { id: input.userId }, data: { bookingRestrictedAt: null, bookingRestrictionReason: null } });
      await appendAdminAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'BOOKING_RESTRICTION_LIFTED',
        entityType: 'User',
        entityId: input.userId,
        requestId: input.requestId,
        metadata: { reason: input.reason, previousReason: user.bookingRestrictionReason },
      });
      return { changed: true };
    });
  }
}
