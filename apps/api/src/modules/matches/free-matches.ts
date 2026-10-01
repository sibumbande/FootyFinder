import type { Prisma } from '../../generated/prisma/client.js';

/**
 * CEO touch-up batch 3, item 5 (D6): a "first-time player" has never played a match: no kickoff lineup entry
 * (as a player, not "did not play") in a completed match, and no joined place in a completed pre-Gate-8 match
 * with a legacy result. The same idea as the player statistics.
 */
export async function hasPlayedAMatch(tx: Prisma.TransactionClient, userId: string) {
  const lineup = await tx.matchLineupEntry.findFirst({
    where: { userId, didNotPlay: false, match: { status: 'COMPLETED' } },
    select: { id: true },
  });
  if (lineup) return true;
  const legacy = await tx.matchParticipant.findFirst({
    where: { userId, status: 'JOINED', match: { status: 'COMPLETED', result: { finalSource: 'LEGACY' } } },
    select: { id: true },
  });
  return Boolean(legacy);
}

/**
 * CEO touch-up batch 3, item 5 (D5): FootyFinder no longer covers these free-match places (the player left, or
 * the match was cancelled). Only the promotions ledger changes; no wallet is touched.
 */
export function reversePromotionalCosts(
  tx: Prisma.TransactionClient,
  where: { participantId: string } | { matchId: string },
  reason: string,
  now: Date,
) {
  return tx.promotionalCost.updateMany({
    where: { ...where, status: 'ACTIVE' },
    data: { status: 'REVERSED', reversedAt: now, reversalReason: reason },
  });
}
