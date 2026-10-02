import { matchCreditExpiresAt } from '@footy-finder/shared';
import type { MatchCreditReason, Prisma } from '../../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;

/**
 * DEC-021 A4: issues one match credit (1 credit = 1 ticket to any paid match), valid for 3 years from issue (CPA s63,
 * CEO D3), personal and non-transferable, with an ISSUED ledger entry linked to the ticket it came from. Idempotent:
 * a ticket gives at most one credit (unique sourceTicketId).
 *
 * originTicketId is the paid ticket the credit ultimately came from (D11): a credit for a paid ticket points at that
 * ticket; a credit returned for a credit-paid ticket inherits the used credit's origin; a goodwill or dev credit has
 * none (no cash origin).
 */
export async function issueCreditInTx(
  tx: Tx,
  input: { userId: string; reason: MatchCreditReason; sourceTicketId?: string; originTicketId?: string | null; actorUserId?: string; note?: string; now?: Date },
) {
  if (input.sourceTicketId) {
    const existing = await tx.matchCredit.findUnique({ where: { sourceTicketId: input.sourceTicketId } });
    if (existing) return existing;
  }
  const issuedAt = input.now ?? new Date();
  const credit = await tx.matchCredit.create({
    data: {
      userId: input.userId,
      reason: input.reason,
      sourceTicketId: input.sourceTicketId,
      originTicketId: input.originTicketId ?? null,
      issuedAt,
      expiresAt: matchCreditExpiresAt(issuedAt),
    },
  });
  await tx.matchCreditEvent.create({ data: { creditId: credit.id, type: 'ISSUED', ticketId: input.sourceTicketId, actorUserId: input.actorUserId, note: input.note } });
  return credit;
}

/**
 * A4: a credit-paid ticket that is left (more than 24 hours before) or cancelled is returned as a credit, never cash
 * (it was never cash). The new credit is valid 3 years from its return (CEO D3) and keeps the original cash origin.
 */
export async function returnCreditForTicketInTx(tx: Tx, ticketId: string, now: Date) {
  const ticket = await tx.matchTicket.findUniqueOrThrow({ where: { id: ticketId }, include: { creditUsed: true } });
  return issueCreditInTx(tx, {
    userId: ticket.payerId,
    reason: 'CREDIT_RETURNED',
    sourceTicketId: ticket.id,
    originTicketId: ticket.creditUsed?.originTicketId ?? null,
    now,
  });
}
