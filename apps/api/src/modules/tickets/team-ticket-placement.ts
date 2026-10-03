import { teamPaymentCutoffAt } from '@footy-finder/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../database/prisma.js';
import { lockMatchForFormation } from '../matches/matches.repository.js';
import { notificationDedupeKey, persistNotifications } from '../notifications/notification-writer.js';
import type { PlacementResult } from './ticket-placement.js';

type Tx = Prisma.TransactionClient;

/** The fields a team side's payments need (DEC-021 A5). */
export const sideSelect = {
  id: true, side: true, teamId: true, teamNameSnapshot: true, starterCount: true, substituteCount: true, placeFeeCents: true, organisingUserId: true,
  match: {
    select: {
      id: true, name: true, status: true, startsAt: true, goNoGoAt: true, confirmedAt: true, girlsOnly: true, durationMinutes: true,
      otherSideMode: true, otherSideTakenBy: true, participants: { where: { status: 'JOINED' }, select: { id: true } },
    },
  },
} satisfies Prisma.MatchTeamSelect;
export type SideRecord = Prisma.MatchTeamGetPayload<{ select: typeof sideSelect }>;

/** Places this team has paid for: confirmed tickets, plus places forfeited after the T-2h cutoff (D1: not re-checked). */
export async function teamPaidSeats(db: Tx | typeof prisma, matchTeamId: string, cutoffAt: Date) {
  return db.matchTicket.count({
    where: { matchTeamId, OR: [{ status: 'CONFIRMED' }, { status: 'CLOSED', outcome: 'FORFEITED', closedAt: { gte: cutoffAt } }] },
  });
}

export const teamSeats = (teamSide: { starterCount: number | null; substituteCount: number | null }) =>
  (teamSide.starterCount ?? 0) + (teamSide.substituteCount ?? 0);

/**
 * A5: confirms one team place after its payment is verified (or a credit / the demo operator). The place must
 * still be wanted: the match open and before the T-2h cutoff, the team still on that side, the player still in
 * the team and not already paid for, and a place still free. Otherwise the caller refunds it in full to the payer
 * ("If a double payment slips through anyway, the extra seat is refunded automatically").
 */
export async function placeTeamTicketInTx(tx: Tx, ticketId: string, now: Date): Promise<PlacementResult> {
  const ticket = await tx.matchTicket.findUniqueOrThrow({ where: { id: ticketId } });
  if (ticket.status === 'CONFIRMED') return { placed: true, replayed: true, participantId: '', notifications: [] };
  if (!['HELD', 'RELEASED'].includes(ticket.status) || ticket.seat !== 'TEAM') return { placed: false, reason: 'TICKET_NOT_PLACEABLE' };
  if (!ticket.matchTeamId) return { placed: false, reason: 'TEAM_WITHDRAWN' };
  await lockMatchForFormation(tx, ticket.matchId);
  const teamSide = await tx.matchTeam.findUnique({ where: { id: ticket.matchTeamId }, select: sideSelect });
  if (!teamSide?.teamId) return { placed: false, reason: 'TEAM_WITHDRAWN' };
  const match = teamSide.match;
  if (!['OPEN', 'READY'].includes(match.status) || match.confirmedAt) return { placed: false, reason: 'MATCH_CLOSED' };
  if (now >= teamPaymentCutoffAt(match.startsAt)) return { placed: false, reason: 'TEAM_PAYMENTS_CLOSED' };
  if (!(await tx.teamMembership.count({ where: { teamId: teamSide.teamId, userId: ticket.playerId } }))) return { placed: false, reason: 'NOT_IN_TEAM' };
  if (await tx.matchTicket.count({ where: { matchTeamId: teamSide.id, playerId: ticket.playerId, status: 'CONFIRMED' } })) return { placed: false, reason: 'ALREADY_IN_MATCH' };
  const confirmed = await tx.matchTicket.count({ where: { matchTeamId: teamSide.id, status: 'CONFIRMED' } });
  if (confirmed >= teamSeats(teamSide)) return { placed: false, reason: 'SIDE_FULL' };
  await tx.matchTicket.update({ where: { id: ticket.id }, data: { status: 'CONFIRMED', confirmedAt: now, releasedAt: null } });
  return { placed: true, replayed: false, participantId: '', notifications: [] };
}

/** Tells each teammate someone else paid for that their place is paid (in the app). */
export async function notifyPlayersPaidFor(tx: Tx, checkoutId: string) {
  const tickets = await tx.matchTicket.findMany({
    where: { checkoutId, status: 'CONFIRMED' },
    include: { payer: { select: { username: true, profile: { select: { displayName: true } } } } },
  });
  return persistNotifications(
    tx,
    tickets
      .filter(({ playerId, payerId }) => playerId !== payerId)
      .map((ticket) => ({
        userId: ticket.playerId,
        type: 'INFO' as const,
        title: 'Your place is paid',
        message: `${ticket.payer.profile?.displayName ?? ticket.payer.username} paid for your place in this team match.`,
        targetPath: `/matches/${ticket.matchId}`,
        dedupeKey: notificationDedupeKey('ticket', ticket.id, 'paid-for', ticket.playerId),
      })),
  );
}
