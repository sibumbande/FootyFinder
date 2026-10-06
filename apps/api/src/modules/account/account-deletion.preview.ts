import {
  ACCOUNT_DELETION_GRACE_DAYS,
  getMatchEndsAt,
  isLobbyFrozen,
  ticketLeaveOutcome,
  type AccountDeletionBlocker,
  type AccountDeletionMatchOutcome,
  type AccountDeletionMatchPlan,
  type AccountDeletionPreview,
  type AccountDeletionTeamPlan,
} from '@footy-finder/shared';
import type { MatchTicket, Prisma } from '../../generated/prisma/client.js';

type Db = Prisma.TransactionClient;
const DAY_MS = 24 * 60 * 60 * 1000;
const FINISHED = ['COMPLETED', 'CANCELLED'] as const;
/** Refund states that mean money is still on its way somewhere (ToS 14.7). */
export const REFUND_IN_PROGRESS_STATUSES = ['PENDING', 'PROCESSING', 'NEEDS_ATTENTION', 'FAILED'] as const;
const ACTIVE_SELECTIONS = ['INVITED', 'SELECTED_STARTER', 'SELECTED_SUBSTITUTE', 'OPEN_SLOT_CLAIMED'] as const;

export const deletionScheduledFor = (now: Date) => new Date(now.getTime() + ACCOUNT_DELETION_GRACE_DAYS * DAY_MS);

type TimedMatch = { startsAt: Date; durationMinutes: number; goNoGoAt: Date | null };
/** From the 30-minute lock (or kick-off for a legacy match) until the scheduled end. */
const lockedNow = (match: TimedMatch, now: Date) =>
  now < getMatchEndsAt(match) && (isLobbyFrozen(match, now) || now >= match.startsAt);
const ended = (match: TimedMatch, now: Date) => now >= getMatchEndsAt(match);

/**
 * DEC-021 D11: what leaving gives back on confirm, by the normal ticket rules (A2, A5). More than 24 hours out a
 * place you paid for is refunded (a credit would lapse or be refunded anyway), a credit-paid place gives its credit
 * back, and a place a teammate paid for is the payer's choice; 24 hours or less, nothing comes back.
 */
export function ticketPlanFor(ticket: Pick<MatchTicket, 'method' | 'payerId' | 'amountCents'> | undefined, userId: string, startsAt: Date, now: Date): { outcome: AccountDeletionMatchOutcome; refundCents: number } {
  if (!ticket || ticket.method === 'FREE') return { outcome: 'NOTHING_PAID', refundCents: 0 };
  if (ticketLeaveOutcome(startsAt, now) === 'NOTHING') return { outcome: 'FORFEITED', refundCents: 0 };
  if (ticket.payerId !== userId && ticket.method === 'PAYMENT') return { outcome: 'PAYER_CHOOSES', refundCents: 0 };
  if (ticket.method === 'CREDIT') return { outcome: 'CREDIT_BACK', refundCents: 0 };
  return { outcome: 'REFUNDED', refundCents: ticket.amountCents };
}

/**
 * CEO batch 5, item 1: everything the "Delete my account" summary shows, and the blockers that stop it.
 * Runs inside the confirm transaction too, so the checks the player saw are the checks that are applied.
 */
export async function buildDeletionPreview(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<AccountDeletionPreview> {
  const blockers: AccountDeletionBlocker[] = [];
  const block = (code: AccountDeletionBlocker['code'], message: string, targetPath: string | null = null) =>
    blockers.push({ code, message, targetPath });

  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      platformRole: true,
      accountStatus: true,
      refereeGrants: { where: { revokedAt: null }, select: { id: true }, take: 1 },
    },
  });
  if (user.platformRole === 'ADMIN')
    block('ADMIN', 'Admin accounts cannot be deleted here. Another admin must remove your admin role first.');
  if (user.refereeGrants.length)
    block('REFEREE', 'You are a FootyFinder Referee. Ask an admin to remove your referee role first.');
  if (user.accountStatus === 'SUSPENDED' || user.accountStatus === 'BANNED')
    block('ACCOUNT_RESTRICTED', 'Your account is restricted, so it cannot be deleted in the app. Contact support.');

  const matches: AccountDeletionMatchPlan[] = [];
  // DEC-021: the player's confirmed tickets (their own places, whoever paid) decide what leaving gives back.
  const tickets = new Map(
    (await db.matchTicket.findMany({ where: { playerId: userId, status: 'CONFIRMED', match: { status: { notIn: [...FINISHED] } } }, select: { matchId: true, method: true, payerId: true, amountCents: true } }))
      .map((ticket) => [ticket.matchId, ticket]),
  );
  const participations = await db.matchParticipant.findMany({
    where: { userId, status: 'JOINED', match: { status: { notIn: [...FINISHED] } } },
    select: {
      match: {
        select: { id: true, name: true, startsAt: true, durationMinutes: true, goNoGoAt: true, mode: true, otherSideMode: true },
      },
    },
  });
  for (const { match } of participations) {
    if (ended(match, now) || (match.mode === 'TEAM_MATCH' && !match.otherSideMode)) continue;
    if (lockedNow(match, now)) {
      block('MATCH_LOCKED', `You are in "${match.name}", which is locked or being played. You can delete your account once it has finished.`, `/matches/${match.id}`);
      continue;
    }
    matches.push({ matchId: match.id, name: match.name, startsAt: match.startsAt.toISOString(), ...ticketPlanFor(tickets.get(match.id), userId, match.startsAt, now) });
  }

  const selections = await db.teamMatchSelection.findMany({
    where: { userId, status: { in: [...ACTIVE_SELECTIONS] }, matchTeam: { match: { status: { notIn: [...FINISHED] } } } },
    select: { matchTeam: { select: { match: { select: { id: true, name: true, startsAt: true, durationMinutes: true, goNoGoAt: true } } } } },
  });
  for (const { matchTeam: { match } } of selections) {
    if (ended(match, now) || matches.some(({ matchId }) => matchId === match.id)) continue;
    if (lockedNow(match, now)) {
      block('MATCH_LOCKED', `You are in your Team's lineup for "${match.name}", which is locked or being played. You can delete your account once it has finished.`, `/matches/${match.id}`);
      continue;
    }
    // A5: a team place someone paid for is left under the ticket rules (the credit or refund goes to the payer).
    const ticket = tickets.get(match.id);
    matches.push({
      matchId: match.id,
      name: match.name,
      startsAt: match.startsAt.toISOString(),
      ...(ticket ? ticketPlanFor(ticket, userId, match.startsAt, now) : { outcome: 'LEFT_OUT_OF_SQUAD' as const, refundCents: 0 }),
    });
  }

  // D3: a Quick Match the player hosts. Nobody joined: cancelled on confirm. Others joined: blocked.
  const hosted = await db.match.findMany({
    where: { createdById: userId, hostedByFootyFinder: false, mode: 'QUICK_GAME', status: { notIn: [...FINISHED] }, startsAt: { gt: now } },
    select: {
      id: true, name: true, startsAt: true, durationMinutes: true, goNoGoAt: true,
      participants: { where: { status: 'JOINED', userId: { not: userId } }, select: { id: true }, take: 1 },
    },
  });
  for (const match of hosted) {
    if (lockedNow(match, now)) continue; // past the lock the host can do nothing; the go/no-go check decides it
    if (match.participants.length)
      block('HOSTING_MATCH', `You are hosting "${match.name}" and other players have joined. Cancel it (everyone who paid chooses a match credit or a refund) or wait until it has been played.`, `/matches/${match.id}`);
    else
      matches.push({ matchId: match.id, name: match.name, startsAt: match.startsAt.toISOString(), outcome: 'HOSTED_MATCH_CANCELLED', refundCents: 0 });
  }

  const teams: AccountDeletionTeamPlan[] = [];
  const memberships = await db.teamMembership.findMany({
    where: { userId, team: { archivedAt: null } },
    select: { role: true, team: { select: { id: true, name: true, ownerUserId: true, _count: { select: { memberships: true } } } } },
  });
  for (const { role, team } of memberships) {
    if (team.ownerUserId !== userId) {
      teams.push({ teamId: team.id, name: team.name, role, outcome: 'LEAVE' });
      continue;
    }
    const upcoming = await db.match.count({
      where: { teamSides: { some: { teamId: team.id } }, visibility: 'PUBLIC', status: { in: ['OPEN', 'READY', 'IN_PROGRESS', 'AWAITING_RESULT'] } },
    });
    const path = `/teams/${team.id}`;
    if (team._count.memberships > 1)
      block('TEAM_OWNER_HAS_MEMBERS', `You own ${team.name}, which has other members. Make a Captain the Owner, or close the team.`, path);
    else if (upcoming)
      block('TEAM_OWNER_UPCOMING_MATCH', `You own ${team.name}, which has an upcoming Team Match. Cancel it or wait until it has been played.`, path);
    teams.push({ teamId: team.id, name: team.name, role: 'OWNER', outcome: 'CLOSE' });
  }

  // D11: unused credits from a paid ticket are refunded at the final step; credits with no cash origin lapse.
  const credits = await db.matchCredit.findMany({ where: { userId, status: 'AVAILABLE', expiresAt: { gt: now } }, select: { originTicketId: true } });
  const [openDisputes, refundsInProgress, pendingPayments, paidWith] = await Promise.all([
    db.providerDispute.count({ where: { status: 'OPEN', providerPayment: { userId } } }),
    db.providerRefund.count({ where: { status: { in: [...REFUND_IN_PROGRESS_STATUSES] }, providerPayment: { userId } } }),
    db.providerPayment.count({ where: { userId, purpose: 'TICKETS', status: { in: ['INITIALIZED', 'REVIEW'] }, checkout: { tickets: { some: { status: 'HELD' } } } } }),
    db.providerPayment.findMany({ where: { userId, status: 'SUCCEEDED', channel: { not: null } }, distinct: ['channel'], select: { channel: true } }),
  ]);
  if (openDisputes)
    block('OPEN_DISPUTE', 'A payment of yours is disputed with your bank (a chargeback). It must be resolved first.', '/tickets');
  if (refundsInProgress)
    block('REFUND_IN_PROGRESS', 'A refund to your card or bank account is still in progress. Wait until it is finished, or contact support.', '/tickets');
  if (pendingPayments)
    block('PAYMENT_PENDING', 'A payment for a match ticket is still being confirmed with Paystack. Try again in a few minutes.', '/tickets');

  matches.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return {
    canDelete: blockers.length === 0,
    blockers,
    matches,
    teams,
    credits: {
      refunded: credits.filter(({ originTicketId }) => originTicketId).length,
      lapsing: credits.filter(({ originTicketId }) => !originTicketId).length,
      paymentMethods: paidWith.map(({ channel }) => channel!),
    },
    graceDays: ACCOUNT_DELETION_GRACE_DAYS,
    scheduledFor: deletionScheduledFor(now).toISOString(),
  };
}
