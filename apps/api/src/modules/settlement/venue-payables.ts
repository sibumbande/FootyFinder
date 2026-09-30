import type { Prisma } from '../../generated/prisma/client.js';

/**
 * DEC-012 + DEC-018 (CEO decisions D1 and D4): a venue is owed money only for a match that went
 * ahead. Called inside the same serializable transaction that moves a match to IN_PROGRESS at
 * kickoff. It creates at most one DUE payable per reservation, from the admin-only price snapshot,
 * and only for a confirmed go/no-go Quick Match or (Gate 7, DEC-019) public team match with a
 * CONFIRMED reservation.
 * - A cancelled match (T-30 auto-cancel or host cancel) never kicks off, so never gets here.
 * - A legacy match (no goNoGoAt/confirmedAt) gets no payable; reconciliation lists it for finance.
 * - The VenuePayable INSERT trigger enforces the same rule in the database.
 */
export async function createVenuePayableForStartedMatch(tx: Prisma.TransactionClient, matchId: string) {
  const match = await tx.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      mode: true,
      otherSideMode: true,
      status: true,
      startsAt: true,
      goNoGoAt: true,
      confirmedAt: true,
      fieldReservation: {
        select: { id: true, status: true, priceCentsSnapshot: true, currencySnapshot: true, field: { select: { venueId: true } } },
      },
    },
  });
  const reservation = match?.fieldReservation;
  if (
    !match ||
    !reservation ||
    !(match.mode === 'QUICK_GAME' || (match.mode === 'TEAM_MATCH' && match.otherSideMode)) ||
    match.status !== 'IN_PROGRESS' ||
    !match.goNoGoAt ||
    !match.confirmedAt ||
    reservation.status !== 'CONFIRMED'
  )
    return null;
  await tx.venuePayable.createMany({
    data: [
      {
        reservationId: reservation.id,
        matchId: match.id,
        venueId: reservation.field.venueId,
        amountCents: reservation.priceCentsSnapshot,
        currency: reservation.currencySnapshot,
        dueAt: match.startsAt,
      },
    ],
    skipDuplicates: true,
  });
  return tx.venuePayable.findUnique({ where: { reservationId: reservation.id } });
}
