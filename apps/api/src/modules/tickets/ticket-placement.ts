import { decideOtherSide, getMaxParticipantsPerTeam, MATCH_FEE_CENTS, type TeamSide } from '@footy-finder/shared';
import type { Notification, Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../errors/app-error.js';
import { notificationDedupeKey, persistNotifications, type NotificationDraft } from '../notifications/notification-writer.js';
import { appendTeamMatchAudit } from '../team-matches/team-match-audit.js';
import { hasPlayedAMatch } from '../matches/free-matches.js';
import { assertGirlsOnlyEligible } from '../matches/girls-only.js';
import { hostAudience } from '../matches/host.js';
import { assertNoPlayerOverlap, PlayerOverlapError, playerOverlapAppError } from '../matches/player-overlap.js';
import {
  assertLobbyOpen,
  bumpFormationVersion,
  LineupLockedError,
  lockMatchForFormation,
  MatchClosedError,
} from '../matches/matches.repository.js';

type Tx = Prisma.TransactionClient;

/**
 * DEC-021 A1: why a place cannot be bought (or, when a payment confirms, can no longer be given). Each maps to a
 * stable API error code. At confirmation time any of these means the payment is refunded in full (A1.4, D5).
 */
const REFUSALS = {
  MATCH_CLOSED: [409, 'This match is no longer accepting players.'],
  LINEUP_LOCKED: [409, 'The lineup is locked 30 minutes before kick-off.'],
  NOT_A_QUICK_PLACE: [409, 'Places in this match are paid for by the teams.'],
  OTHER_SIDE_REFUSED: [409, 'Players can no longer join this side.'],
  OWN_TEAM_CONFLICT: [409, 'You can’t play against your own team.'],
  ALREADY_IN_MATCH: [409, 'You already have a place in this match.'],
  SIDE_FULL: [409, 'That side is full.'],
  POSITION_NOT_FOUND: [404, 'That position does not exist.'],
  POSITION_WRONG_SIDE: [409, 'That position is on the other side.'],
  POSITION_ALREADY_CLAIMED: [409, 'Someone already has that position.'],
  POSITION_BEING_BOOKED: [409, 'Someone is paying for that position right now. Try another one, or check again in a few minutes.'],
  FIRST_TIMERS_ONLY: [409, 'This free match is for players who have never played a match on FootyFinder.'],
  BOOKING_RESTRICTED: [403, 'A payment of yours is disputed with your bank, so you can’t buy tickets or use credits until it is resolved.'],
} as const satisfies Record<string, readonly [number, string]>;
export type PlacementRefusal = keyof typeof REFUSALS;
export const refusal = (code: PlacementRefusal) => new AppError(REFUSALS[code][0], REFUSALS[code][1], code);

type PlaceableMatch = {
  id: string;
  name: string;
  mode: string;
  status: string;
  format: Parameters<typeof getMaxParticipantsPerTeam>[0];
  substituteCapacityPerTeam: number;
  startsAt: Date;
  durationMinutes: number;
  goNoGoAt: Date | null;
  otherSideMode: 'TEAMS_ONLY' | 'OPEN' | null;
  otherSideTakenBy: 'TEAM' | 'INDIVIDUALS' | null;
  firstTimersOnly: boolean;
  girlsOnly: boolean;
  freeOnFootyFinder: boolean;
  createdById: string;
  hostedByFootyFinder: boolean;
};

export const placeableMatchSelect = {
  id: true, name: true, mode: true, status: true, format: true, substituteCapacityPerTeam: true, startsAt: true,
  durationMinutes: true, goNoGoAt: true, otherSideMode: true, otherSideTakenBy: true, firstTimersOnly: true,
  girlsOnly: true, freeOnFootyFinder: true, createdById: true, hostedByFootyFinder: true, feeCents: true,
} satisfies Prisma.MatchSelect;

/** Holds whose 10 minutes have passed no longer occupy anything; mark them released (the job does the same). */
export async function releaseExpiredHolds(tx: Tx, matchId: string, now: Date) {
  await tx.matchTicket.updateMany({
    where: { matchId, status: 'HELD', holdExpiresAt: { lte: now } },
    data: { status: 'RELEASED', releasedAt: now },
  });
}

/**
 * Every rule for one individual place in a Quick Match (or the individuals side of an "Open to both" team match),
 * checked when the place is held and again when its payment is confirmed. `ticketId` is the ticket being placed,
 * so its own hold does not count against it. Call under the Match row lock.
 */
export async function assertTicketPlaceable(
  tx: Tx,
  input: { match: PlaceableMatch; playerId: string; side: TeamSide; seat: 'POSITION' | 'SUBSTITUTE'; slotId?: string | null; ticketId?: string; now: Date },
) {
  const { match, playerId, side, now } = input;
  const exceptSelf = input.ticketId ? { id: { not: input.ticketId } } : {};
  if (match.mode === 'TEAM_MATCH') {
    if (!match.otherSideMode) throw refusal('NOT_A_QUICK_PLACE');
    if (side !== 'AWAY') throw refusal('NOT_A_QUICK_PLACE');
  }
  try {
    assertLobbyOpen(match, now);
  } catch (error) {
    if (error instanceof LineupLockedError) throw refusal('LINEUP_LOCKED');
    if (error instanceof MatchClosedError) throw refusal('MATCH_CLOSED');
    throw error;
  }
  const joined = await tx.matchParticipant.findMany({ where: { matchId: match.id, status: 'JOINED' }, select: { userId: true, team: true } });
  if (joined.some(({ userId }) => userId === playerId)) throw refusal('ALREADY_IN_MATCH');
  if (await tx.matchTicket.count({ where: { matchId: match.id, playerId, status: { in: ['HELD', 'CONFIRMED'] }, ...exceptSelf } }))
    throw refusal('ALREADY_IN_MATCH');
  if (match.otherSideMode) {
    const individuals = joined.filter(({ team }) => team === 'AWAY').length;
    const decision = decideOtherSide({ mode: match.otherSideMode, takenBy: match.otherSideTakenBy, joinedIndividuals: individuals }, 'INDIVIDUAL');
    if ('reason' in decision) throw refusal('OTHER_SIDE_REFUSED');
    const ownTeam = await tx.teamMembership.count({ where: { userId: playerId, team: { matchSides: { some: { matchId: match.id, side: 'HOME' } } } } });
    if (ownTeam) throw refusal('OWN_TEAM_CONFLICT');
  }
  const holdsOnSide = await tx.matchTicket.count({
    where: { matchId: match.id, side, status: 'HELD', holdExpiresAt: { gt: now }, matchTeamId: null, ...exceptSelf },
  });
  if (joined.filter(({ team }) => team === side).length + holdsOnSide >= getMaxParticipantsPerTeam(match.format, match.substituteCapacityPerTeam))
    throw refusal('SIDE_FULL');
  if (input.seat === 'POSITION') {
    const slot = input.slotId ? await tx.formationSlot.findFirst({ where: { id: input.slotId, matchId: match.id } }) : null;
    if (!slot) throw refusal('POSITION_NOT_FOUND');
    if (slot.team !== side) throw refusal('POSITION_WRONG_SIDE');
    if (slot.participantId) throw refusal('POSITION_ALREADY_CLAIMED');
    if (await tx.matchTicket.count({ where: { slotId: slot.id, status: 'HELD', holdExpiresAt: { gt: now }, ...exceptSelf } }))
      throw refusal('POSITION_BEING_BOOKED');
  }
  if (match.firstTimersOnly && (await hasPlayedAMatch(tx, playerId))) throw refusal('FIRST_TIMERS_ONLY');
  await assertGirlsOnlyEligible(tx, match, [playerId]);
  try {
    await assertNoPlayerOverlap(tx, playerId, match);
  } catch (error) {
    if (error instanceof PlayerOverlapError) throw playerOverlapAppError(error);
    throw error;
  }
}

export type PlacementResult =
  | { placed: true; replayed: boolean; participantId: string; notifications: Notification[] }
  | { placed: false; reason: string };

/**
 * DEC-021 A1.3: puts the ticket's player into the match, only ever after a verified payment (or a credit / free
 * place). Re-checks every rule under the Match row lock; if the place or the match is gone, returns the reason and
 * changes nothing (the caller refunds the payment in full, A1.4 / D5). Idempotent: a confirmed ticket is a replay.
 */
export async function placeTicketInTx(tx: Tx, ticketId: string, now: Date): Promise<PlacementResult> {
  const peek = await tx.matchTicket.findUniqueOrThrow({ where: { id: ticketId }, select: { matchId: true } });
  await lockMatchForFormation(tx, peek.matchId);
  const ticket = await tx.matchTicket.findUniqueOrThrow({ where: { id: ticketId } });
  if (ticket.status === 'CONFIRMED' && ticket.participantId)
    return { placed: true, replayed: true, participantId: ticket.participantId, notifications: [] };
  if (!['HELD', 'RELEASED'].includes(ticket.status) || ticket.seat === 'TEAM') return { placed: false, reason: 'TICKET_NOT_PLACEABLE' };
  const match = await tx.match.findUniqueOrThrow({ where: { id: ticket.matchId }, select: placeableMatchSelect });
  try {
    await assertTicketPlaceable(tx, { match, playerId: ticket.playerId, side: ticket.side, seat: ticket.seat, slotId: ticket.slotId, ticketId, now });
  } catch (error) {
    if (error instanceof AppError) return { placed: false, reason: error.code ?? 'NOT_PLACEABLE' };
    throw error;
  }

  // Gate 7: the side is marked as taken by individuals before the first one joins (a DB trigger requires it).
  if (match.otherSideMode && match.otherSideTakenBy !== 'INDIVIDUALS') {
    await tx.match.update({ where: { id: match.id }, data: { otherSideTakenBy: 'INDIVIDUALS' } });
    await appendTeamMatchAudit(tx, { matchId: match.id, command: 'OTHER_SIDE_INDIVIDUALS_OPENED', side: 'AWAY', actorUserId: ticket.playerId });
  }
  const participant = await tx.matchParticipant.upsert({
    where: { matchId_userId: { matchId: match.id, userId: ticket.playerId } },
    create: { matchId: match.id, userId: ticket.playerId, team: ticket.side },
    update: { status: 'JOINED', team: ticket.side, joinedAt: now, leftAt: null },
    include: { user: { select: { username: true, profile: { select: { displayName: true } } } } },
  });
  // A rejoin reuses the participant row: its earlier, closed ticket lets go of it first.
  await tx.matchTicket.updateMany({ where: { participantId: participant.id, id: { not: ticket.id } }, data: { participantId: null } });
  if (ticket.seat === 'POSITION' && ticket.slotId) {
    const claimed = await tx.formationSlot.updateMany({ where: { id: ticket.slotId, participantId: null }, data: { participantId: participant.id } });
    if (claimed.count !== 1) throw new Error('POSITION_CLAIM_RACE'); // impossible under the Match row lock
    const formationVersion = await bumpFormationVersion(tx, match.id);
    await tx.matchFormationEvent.create({
      data: { matchId: match.id, slotId: ticket.slotId, actorUserId: ticket.playerId, action: 'SELF_CLAIM', participantId: participant.id, previousParticipantId: null, formationVersion },
    });
  }
  // A free match: FootyFinder covers the fee in its promotions ledger (CEO batch 3, item 5; unchanged).
  if (ticket.method === 'FREE')
    await tx.promotionalCost.upsert({
      where: { participantId: participant.id },
      create: { matchId: match.id, participantId: participant.id, userId: ticket.playerId, amountCents: MATCH_FEE_CENTS, description: `Free match on FootyFinder: ${match.name}` },
      update: { status: 'ACTIVE', reversedAt: null, reversalReason: null },
    });
  await tx.matchTicket.update({ where: { id: ticket.id }, data: { status: 'CONFIRMED', participantId: participant.id, confirmedAt: now, releasedAt: null } });
  await tx.ticketCheckout.updateMany({ where: { id: ticket.checkoutId, status: { not: 'COMPLETED' } }, data: { status: 'COMPLETED', completedAt: now } });

  const sideName = ticket.side === 'HOME' ? 'Home' : 'Away';
  const drafts: NotificationDraft[] = [
    {
      userId: ticket.playerId,
      type: 'MATCH_JOINED',
      title: 'You’re in',
      message: ticket.seat === 'POSITION' ? `Your ticket is confirmed: your position on the ${sideName} side is yours.` : `Your ticket is confirmed: you’re a substitute for the ${sideName} side.`,
      targetPath: `/matches/${match.id}`,
      dedupeKey: notificationDedupeKey('ticket', ticket.id, 'confirmed', ticket.playerId),
    },
  ];
  const audience = new Set([...hostAudience(match), ...(await tx.matchParticipant.findMany({ where: { matchId: match.id, status: 'JOINED' }, select: { userId: true } })).map(({ userId }) => userId)]);
  audience.delete(ticket.playerId);
  const displayName = participant.user.profile?.displayName ?? participant.user.username;
  for (const userId of audience)
    drafts.push({
      userId,
      type: 'INFO',
      title: 'Player joined',
      message: `${displayName} joined the ${sideName} side.`,
      targetPath: `/matches/${match.id}`,
      dedupeKey: notificationDedupeKey('ticket', ticket.id, 'joined-audience', userId),
    });
  return { placed: true, replayed: false, participantId: participant.id, notifications: await persistNotifications(tx, drafts) };
}
