import type { TicketReconciliationIssue, TicketReconciliationReport } from '@footy-finder/shared';
import { prisma } from '../../database/prisma.js';

const STARTED = ['IN_PROGRESS', 'AWAITING_RESULT', 'COMPLETED'] as const;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Grace before a job that should already have run is reported (the durable jobs poll every few seconds). */
const HOLD_GRACE_MS = 15 * 60_000;
const CHOICE_GRACE_MS = DAY_MS;
const CREDIT_EXPIRY_GRACE_MS = 2 * DAY_MS;
/** Paystack usually settles a refund within days; two weeks without an answer needs finance. */
const REFUND_PENDING_MAX_MS = 14 * DAY_MS;
const REFUNDED_OUTCOMES = ['REFUNDED', 'LATE_PAYMENT_REFUNDED', 'DUPLICATE_REFUNDED'];

/**
 * DEC-021 A6: ticket reconciliation (replaces wallet reconciliation). Read-only: it never repairs data, and every
 * issue is for finance review.
 * - every ticket that was confirmed has a verified provider payment, a used match credit, or an R0 free-match reason;
 * - every refund matches a provider refund event, and a refunded ticket has its refund;
 * - credits issued = used + expired + forfeited + refunded + outstanding, each step in the credit ledger;
 * - venue payables, settlement batches and the free-match promotions ledger are checked as before.
 */
export class TicketReconciliationService {
  async report(now = new Date()): Promise<TicketReconciliationReport> {
    const issues: TicketReconciliationIssue[] = [];
    const { ticketCount, paymentCount } = await this.tickets(issues, now);
    const refundCount = await this.refunds(issues, now);
    const credits = await this.credits(issues, now);
    await this.freeMatches(issues);
    await this.accountClosures(issues);
    const payableCount = await this.payables(issues);
    const settlementBatchCount = await this.batches(issues);
    return {
      generatedAt: now.toISOString(),
      ticketCount,
      paymentCount,
      refundCount,
      credits,
      payableCount,
      settlementBatchCount,
      issueCount: issues.length,
      issues,
    };
  }

  private async tickets(issues: TicketReconciliationIssue[], now: Date) {
    const [tickets, payments] = await Promise.all([
      prisma.matchTicket.findMany({
        select: {
          id: true, payerId: true, status: true, method: true, amountCents: true, confirmedAt: true, holdExpiresAt: true,
          choiceDeadlineAt: true, outcome: true,
          checkout: { select: { providerPayment: { select: { purpose: true, status: true, verifiedAt: true } } } },
          creditUsed: { select: { status: true } },
          refunds: { where: { creditId: null }, select: { id: true } },
        },
      }),
      prisma.providerPayment.findMany({
        where: { purpose: 'TICKETS' },
        select: {
          id: true, userId: true, status: true, amountCents: true, reviewReason: true,
          checkout: { select: { amountCents: true, tickets: { select: { id: true, confirmedAt: true, refunds: { where: { creditId: null }, select: { id: true } } } } } },
        },
      }),
    ]);
    for (const ticket of tickets) {
      const confirmed = Boolean(ticket.confirmedAt);
      if (confirmed && ticket.method === 'PAYMENT') {
        const payment = ticket.checkout.providerPayment;
        if (!payment || payment.purpose !== 'TICKETS' || payment.status !== 'SUCCEEDED' || !payment.verifiedAt)
          issues.push({ code: 'TICKET_PAYMENT_UNVERIFIED', userId: ticket.payerId, referenceId: ticket.id, expectedCents: ticket.amountCents, detail: payment ? payment.status.toLowerCase() : 'no_payment' });
      }
      if (confirmed && ticket.method === 'CREDIT' && ticket.creditUsed?.status !== 'USED')
        issues.push({ code: 'TICKET_CREDIT_MISSING', userId: ticket.payerId, referenceId: ticket.id });
      if (ticket.method === 'FREE' && ticket.amountCents !== 0)
        issues.push({ code: 'TICKET_FREE_NOT_ZERO', userId: ticket.payerId, referenceId: ticket.id, expectedCents: 0, actualCents: ticket.amountCents });
      if (ticket.status === 'HELD' && ticket.holdExpiresAt && now.getTime() - ticket.holdExpiresAt.getTime() > HOLD_GRACE_MS)
        issues.push({ code: 'TICKET_HOLD_OVERDUE', userId: ticket.payerId, referenceId: ticket.id });
      if (ticket.status === 'CHOICE_PENDING' && ticket.choiceDeadlineAt && now.getTime() - ticket.choiceDeadlineAt.getTime() > CHOICE_GRACE_MS)
        issues.push({ code: 'TICKET_CHOICE_OVERDUE', userId: ticket.payerId, referenceId: ticket.id, expectedCents: ticket.amountCents });
      if (ticket.outcome && REFUNDED_OUTCOMES.includes(ticket.outcome) && ticket.refunds.length === 0)
        issues.push({ code: 'TICKET_REFUND_MISSING', userId: ticket.payerId, referenceId: ticket.id, expectedCents: ticket.amountCents, detail: ticket.outcome.toLowerCase() });
    }
    for (const payment of payments) {
      if (payment.status === 'REVIEW')
        issues.push({ code: 'TICKET_PAYMENT_UNDER_REVIEW', userId: payment.userId, referenceId: payment.id, expectedCents: payment.amountCents, detail: payment.reviewReason ?? undefined });
      if (!payment.checkout) continue;
      if (payment.checkout.amountCents !== payment.amountCents)
        issues.push({ code: 'CHECKOUT_AMOUNT_MISMATCH', userId: payment.userId, referenceId: payment.id, expectedCents: payment.checkout.amountCents, actualCents: payment.amountCents });
      // Money we kept must have bought a place; otherwise it is on its way back (A1.4 late payment, A5 paid twice).
      if (payment.status === 'SUCCEEDED')
        for (const ticket of payment.checkout.tickets)
          if (!ticket.confirmedAt && ticket.refunds.length === 0)
            issues.push({ code: 'PAID_TICKET_NOT_PLACED_OR_REFUNDED', userId: payment.userId, referenceId: ticket.id });
    }
    return { ticketCount: tickets.length, paymentCount: payments.length };
  }

  private async refunds(issues: TicketReconciliationIssue[], now: Date) {
    const refunds = await prisma.providerRefund.findMany({
      select: {
        id: true, amountCents: true, status: true, providerRefundId: true, processedAt: true, reviewReason: true, failureReason: true,
        createdAt: true, creditId: true,
        ticket: { select: { amountCents: true } },
        providerPayment: { select: { id: true, userId: true, amountCents: true } },
      },
    });
    const committedByPayment = new Map<string, { userId: string; paid: number; committed: number }>();
    for (const refund of refunds) {
      const userId = refund.providerPayment.userId;
      if (refund.ticket && refund.amountCents !== refund.ticket.amountCents)
        issues.push({ code: 'REFUND_AMOUNT_MISMATCH', userId, referenceId: refund.id, expectedCents: refund.ticket.amountCents, actualCents: refund.amountCents });
      if (refund.status === 'PROCESSED' && (!refund.providerRefundId || !refund.processedAt))
        issues.push({ code: 'REFUND_WITHOUT_PROVIDER_EVENT', userId, referenceId: refund.id, actualCents: refund.amountCents });
      if ((refund.status === 'PENDING' || refund.status === 'PROCESSING') && now.getTime() - refund.createdAt.getTime() > REFUND_PENDING_MAX_MS)
        issues.push({ code: 'REFUND_PENDING_TOO_LONG', userId, referenceId: refund.id, expectedCents: refund.amountCents, detail: refund.status.toLowerCase() });
      // CEO batch 5, item 6: a bank refund waiting for the customer's account also needs finance.
      if (refund.status === 'FAILED' || refund.status === 'NEEDS_ATTENTION' || refund.reviewReason)
        issues.push({ code: 'REFUND_NEEDS_FINANCE', userId, referenceId: refund.id, expectedCents: refund.amountCents, detail: refund.reviewReason ?? refund.failureReason ?? refund.status.toLowerCase() });
      if (refund.status === 'RESTORED_TO_WALLET') continue; // earlier payment records only
      const entry = committedByPayment.get(refund.providerPayment.id) ?? { userId, paid: refund.providerPayment.amountCents, committed: 0 };
      entry.committed += refund.amountCents;
      committedByPayment.set(refund.providerPayment.id, entry);
    }
    for (const [paymentId, entry] of committedByPayment)
      if (entry.committed > entry.paid)
        issues.push({ code: 'REFUNDS_EXCEED_PAYMENT', userId: entry.userId, referenceId: paymentId, expectedCents: entry.paid, actualCents: entry.committed });
    return refunds.length;
  }

  /** A4: every credit is ledgered (issued / used / expired / forfeited / refunded) and linked to its ticket. */
  private async credits(issues: TicketReconciliationIssue[], now: Date) {
    const credits = await prisma.matchCredit.findMany({
      select: {
        id: true, userId: true, status: true, reason: true, sourceTicketId: true, usedTicketId: true, expiresAt: true,
        events: { select: { type: true, ticketId: true } },
        refunds: { select: { id: true } },
      },
    });
    const totals = { issued: credits.length, used: 0, expired: 0, forfeited: 0, refunded: 0, outstanding: 0 };
    const closingEvent = { USED: 'USED', EXPIRED: 'EXPIRED', FORFEITED: 'FORFEITED', REFUNDED: 'REFUNDED' } as const;
    for (const credit of credits) {
      const types = new Set(credit.events.map(({ type }) => type));
      const mismatch = (detail: string) => issues.push({ code: 'CREDIT_LEDGER_MISMATCH', userId: credit.userId, referenceId: credit.id, detail });
      if (!types.has('ISSUED')) mismatch('no_issued_entry');
      if (credit.status === 'AVAILABLE') {
        totals.outstanding += 1;
        if ([...types].some((type) => type !== 'ISSUED')) mismatch('available_but_closed_in_ledger');
        if (now.getTime() - credit.expiresAt.getTime() > CREDIT_EXPIRY_GRACE_MS)
          issues.push({ code: 'CREDIT_EXPIRY_OVERDUE', userId: credit.userId, referenceId: credit.id });
      } else {
        totals[credit.status.toLowerCase() as 'used' | 'expired' | 'forfeited' | 'refunded'] += 1;
        if (!types.has(closingEvent[credit.status])) mismatch(`no_${credit.status.toLowerCase()}_entry`);
      }
      if (credit.status === 'USED' && (!credit.usedTicketId || !credit.events.some(({ type, ticketId }) => type === 'USED' && ticketId === credit.usedTicketId)))
        mismatch('use_not_linked_to_ticket');
      if (credit.status === 'REFUNDED' && credit.refunds.length === 0) mismatch('refunded_without_provider_refund');
      // A credit from a paid match is always linked to the ticket it came from (DEV_SEED and GOODWILL have none).
      if (['LEFT_MATCH', 'MATCH_CANCELLED', 'CREDIT_RETURNED'].includes(credit.reason) && !credit.sourceTicketId)
        issues.push({ code: 'CREDIT_SOURCE_MISSING', userId: credit.userId, referenceId: credit.id, detail: credit.reason.toLowerCase() });
    }
    return totals;
  }

  /**
   * CEO touch-up batch 3, item 5 (unchanged by DEC-021): every joined player of a free match has exactly one ACTIVE
   * promotional cover in FootyFinder's own ledger, and no cover stays ACTIVE for a player who left.
   */
  private async freeMatches(issues: TicketReconciliationIssue[]) {
    const matches = await prisma.match.findMany({
      where: { freeOnFootyFinder: true },
      select: { status: true, participants: { select: { id: true, userId: true, status: true, promotionalCost: { select: { status: true } } } } },
    });
    for (const match of matches)
      for (const participant of match.participants) {
        const active = participant.promotionalCost?.status === 'ACTIVE';
        if (participant.status === 'JOINED' && match.status !== 'CANCELLED' && !active)
          issues.push({ code: 'FREE_MATCH_COVER_MISSING', userId: participant.userId, referenceId: participant.id });
        if (active && (participant.status !== 'JOINED' || match.status === 'CANCELLED'))
          issues.push({ code: 'FREE_MATCH_COVER_WITHOUT_PLAYER', userId: participant.userId, referenceId: participant.id });
      }
  }

  /** CEO batch 5, item 6 (ToS 20.2): money of a deleted account that still has to be returned by finance. */
  private async accountClosures(issues: TicketReconciliationIssue[]) {
    const open = await prisma.accountDeletionRequest.findMany({
      where: { status: 'COMPLETED', uncoveredCents: { gt: 0 }, financeSettledAt: null },
      select: { id: true, userId: true, uncoveredCents: true },
    });
    for (const request of open)
      issues.push({ code: 'ACCOUNT_CLOSURE_UNREFUNDED', userId: request.userId, referenceId: request.id, expectedCents: 0, actualCents: request.uncoveredCents });
  }

  /**
   * DEC-018 / D1 / D4: a payable exists exactly for each confirmed go/no-go match that went ahead, equal to its
   * reservation's admin-only price snapshot. Legacy matches are listed apart.
   */
  private async payables(issues: TicketReconciliationIssue[]) {
    const payables = await prisma.venuePayable.findMany({
      select: {
        id: true, amountCents: true,
        reservation: { select: { status: true, priceCentsSnapshot: true } },
        match: { select: { status: true, confirmedAt: true } },
      },
    });
    for (const payable of payables) {
      if (payable.reservation.status !== 'CONFIRMED' || !payable.match.confirmedAt || !(STARTED as readonly string[]).includes(payable.match.status))
        issues.push({ code: 'PAYABLE_NOT_ELIGIBLE', referenceId: payable.id, actualCents: payable.amountCents, detail: `match_${payable.match.status.toLowerCase()}` });
      if (payable.amountCents !== payable.reservation.priceCentsSnapshot)
        issues.push({ code: 'PAYABLE_AMOUNT_MISMATCH', referenceId: payable.id, expectedCents: payable.reservation.priceCentsSnapshot, actualCents: payable.amountCents });
    }
    const unpaidMatches = await prisma.match.findMany({
      where: {
        // Gate 7: DEC-019 team matches owe their venue the same way.
        OR: [{ mode: 'QUICK_GAME' }, { mode: 'TEAM_MATCH', otherSideMode: { not: null } }],
        status: { in: [...STARTED] },
        fieldReservation: { is: { status: 'CONFIRMED' } },
        venuePayable: { is: null },
      },
      select: { id: true, goNoGoAt: true, confirmedAt: true, fieldReservation: { select: { priceCentsSnapshot: true } } },
    });
    for (const match of unpaidMatches)
      issues.push({
        code: match.goNoGoAt ? 'STARTED_MATCH_WITHOUT_PAYABLE' : 'LEGACY_RESERVATION_UNSETTLED',
        referenceId: match.id,
        expectedCents: match.fieldReservation?.priceCentsSnapshot,
        ...(match.goNoGoAt && !match.confirmedAt && { detail: 'started_without_confirmation' }),
      });
    return payables.length;
  }

  private async batches(issues: TicketReconciliationIssue[]) {
    const batches = await prisma.venueSettlementBatch.findMany({
      where: { status: { not: 'CANCELLED' } },
      select: {
        id: true, status: true, payablesCents: true, adjustmentsCents: true, totalCents: true,
        payables: { select: { amountCents: true, status: true } },
        adjustments: { select: { amountCents: true } },
      },
    });
    for (const batch of batches) {
      const payablesCents = batch.payables.reduce((sum, payable) => sum + payable.amountCents, 0);
      const adjustmentsCents = batch.adjustments.reduce((sum, adjustment) => sum + adjustment.amountCents, 0);
      if (payablesCents !== batch.payablesCents || adjustmentsCents !== batch.adjustmentsCents || payablesCents + adjustmentsCents !== batch.totalCents)
        issues.push({ code: 'SETTLEMENT_TOTAL_MISMATCH', referenceId: batch.id, expectedCents: payablesCents + adjustmentsCents, actualCents: batch.totalCents });
      const expectedState = batch.status === 'PAID' ? 'PAID' : 'IN_BATCH';
      if (batch.payables.some((payable) => payable.status !== expectedState))
        issues.push({ code: 'SETTLEMENT_PAYABLE_STATE_MISMATCH', referenceId: batch.id, detail: `expected_${expectedState.toLowerCase()}` });
    }
    return batches.length;
  }
}
