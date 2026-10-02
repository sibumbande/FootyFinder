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

/**
 * A4: takes the payer's oldest usable credit (soonest to expire) for one ticket, under a row lock, so two checkouts
 * racing for the last credit cannot both use it. Returns null when they have none.
 */
export async function useOldestCreditInTx(tx: Tx, input: { userId: string; ticketId: string; now: Date }) {
  const [row] = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "MatchCredit"
    WHERE "userId" = ${input.userId}::uuid AND "status" = 'AVAILABLE' AND "expiresAt" > ${input.now}
    ORDER BY "expiresAt" ASC, "issuedAt" ASC
    LIMIT 1
    FOR UPDATE`;
  if (!row) return null;
  const credit = await tx.matchCredit.update({
    where: { id: row.id },
    data: { status: 'USED', usedTicketId: input.ticketId, usedAt: input.now, closedAt: input.now },
  });
  await tx.matchCreditEvent.create({ data: { creditId: credit.id, type: 'USED', ticketId: input.ticketId, actorUserId: input.userId } });
  return credit;
}

export const MATCH_CREDIT_EXPIRE_JOB = 'MATCH_CREDIT_EXPIRE';

/** A4 / D3: credits past their 3 years expire, with an EXPIRED ledger entry (safe to run twice). No reminder (A8). */
export async function expireMatchCredits(db: { $transaction: (work: (tx: Tx) => Promise<number>) => Promise<number> }, now = new Date()) {
  return db.$transaction(async (tx) => {
    const due = await tx.matchCredit.findMany({ where: { status: 'AVAILABLE', expiresAt: { lte: now } }, select: { id: true } });
    for (const { id } of due) {
      const updated = await tx.matchCredit.updateMany({ where: { id, status: 'AVAILABLE' }, data: { status: 'EXPIRED', closedAt: now } });
      if (updated.count) await tx.matchCreditEvent.create({ data: { creditId: id, type: 'EXPIRED' } });
    }
    return due.length;
  });
}

/** The next 02:30 in Johannesburg (UTC+2) after `now`. */
export const nextCreditExpiryRunAt = (now: Date) => {
  const local = new Date(now.getTime() + 2 * 3_600_000);
  const next = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 2, 30) - 2 * 3_600_000;
  return new Date(next > now.getTime() ? next : next + 24 * 3_600_000);
};
