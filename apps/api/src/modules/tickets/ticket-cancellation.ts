import { ticketChoiceDeadline } from '@footy-finder/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { enqueueDurableJob } from '../../jobs/durable-jobs.js';
import { returnCreditForTicketInTx } from './match-credits.js';

type Tx = Prisma.TransactionClient;

export const TICKET_CHOICE_AUTO_REFUND_JOB_TYPE = 'TICKET_CHOICE_AUTO_REFUND';

export type TicketCancellationOutcome = {
  /** Per payer: seats they must choose a credit or a refund for, and credits returned to them. */
  byPayer: Map<string, { choiceSeats: number; choiceCents: number; creditsReturned: number }>;
};

/**
 * DEC-021 A3: what a cancelled match (by FootyFinder, the venue, the host, the home team, a team's withdrawal of the
 * whole match, the T-2h team payment cutoff or the T-30 check) does to its tickets. Runs inside the shared
 * cancellation core, under the Match row lock.
 * - Paid tickets: the payer chooses 1 match credit or a full refund (CHOICE_PENDING, deadline 7 days); without a
 *   choice they are refunded automatically. Money never silently becomes credit.
 * - Tickets forfeited by leaving 24 hours or less before kick-off get the same choice (CEO D4).
 * - Credit-paid tickets: the credit is returned (it was never cash, A4 / D8).
 * - Free (R0) tickets: nothing is due.
 * - Places still being paid for: released (a payment that arrives later is refunded in full, A1.4).
 */
export async function settleTicketsOnCancellationInTx(tx: Tx, matchId: string, now: Date): Promise<TicketCancellationOutcome> {
  const byPayer: TicketCancellationOutcome['byPayer'] = new Map();
  const add = (payerId: string, change: { choiceSeats?: number; choiceCents?: number; creditsReturned?: number }) => {
    const current = byPayer.get(payerId) ?? { choiceSeats: 0, choiceCents: 0, creditsReturned: 0 };
    byPayer.set(payerId, {
      choiceSeats: current.choiceSeats + (change.choiceSeats ?? 0),
      choiceCents: current.choiceCents + (change.choiceCents ?? 0),
      creditsReturned: current.creditsReturned + (change.creditsReturned ?? 0),
    });
  };
  await tx.matchTicket.updateMany({ where: { matchId, status: 'HELD' }, data: { status: 'RELEASED', releasedAt: now } });
  const tickets = await tx.matchTicket.findMany({
    where: { matchId, OR: [{ status: 'CONFIRMED' }, { status: 'CLOSED', outcome: 'FORFEITED' }] },
    orderBy: { createdAt: 'asc' },
  });
  const deadline = ticketChoiceDeadline(now);
  for (const ticket of tickets) {
    const unseat = { participantId: null };
    if (ticket.method === 'PAYMENT') {
      await tx.matchTicket.update({
        where: { id: ticket.id },
        data: { ...unseat, status: 'CHOICE_PENDING', choiceDeadlineAt: deadline, closedAt: null, outcome: null, confirmedAt: ticket.confirmedAt ?? now, closedReason: null },
      });
      await enqueueDurableJob(tx, {
        type: TICKET_CHOICE_AUTO_REFUND_JOB_TYPE,
        dedupeKey: `ticket-choice-auto-refund:${ticket.id}`,
        payload: { ticketId: ticket.id },
        runAt: deadline,
      });
      add(ticket.payerId, { choiceSeats: 1, choiceCents: ticket.amountCents });
    } else if (ticket.method === 'CREDIT') {
      await returnCreditForTicketInTx(tx, ticket.id, now);
      await tx.matchTicket.update({ where: { id: ticket.id }, data: { ...unseat, status: 'CLOSED', closedAt: now, outcome: 'CREDIT_RETURNED', closedReason: 'Match cancelled' } });
      add(ticket.payerId, { creditsReturned: 1 });
    } else {
      await tx.matchTicket.update({ where: { id: ticket.id }, data: { ...unseat, status: 'CLOSED', closedAt: now, outcome: 'NOTHING_DUE', closedReason: 'Match cancelled' } });
    }
  }
  return { byPayer };
}
