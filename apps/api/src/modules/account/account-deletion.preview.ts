import {
  ACCOUNT_DELETION_GRACE_DAYS,
  getCancellationCreditCents,
  getMatchEndsAt,
  isLobbyFrozen,
  type AccountDeletionBlocker,
  type AccountDeletionMatchPlan,
  type AccountDeletionPreview,
  type AccountDeletionTeamPlan,
} from '@footy-finder/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { formatRands } from '../matches/cancellation-message.js';
import { TeamWalletRepository } from '../team-wallet/team-wallet.repository.js';

type Db = Prisma.TransactionClient;
const DAY_MS = 24 * 60 * 60 * 1000;
const FINISHED = ['COMPLETED', 'CANCELLED'] as const;
/** Refund states that mean money is still on its way somewhere (ToS 13.5, 14.7). */
export const REFUND_IN_PROGRESS_STATUSES = ['PENDING', 'PROCESSING', 'NEEDS_ATTENTION', 'FAILED'] as const;
const ACTIVE_SELECTIONS = ['INVITED', 'SELECTED_STARTER', 'SELECTED_SUBSTITUTE', 'OPEN_SLOT_CLAIMED'] as const;

export const deletionScheduledFor = (now: Date) => new Date(now.getTime() + ACCOUNT_DELETION_GRACE_DAYS * DAY_MS);

type TimedMatch = { startsAt: Date; durationMinutes: number; goNoGoAt: Date | null };
/** From the 30-minute lock (or kick-off for a legacy match) until the scheduled end. */
const lockedNow = (match: TimedMatch, now: Date) =>
  now < getMatchEndsAt(match) && (isLobbyFrozen(match, now) || now >= match.startsAt);
const ended = (match: TimedMatch, now: Date) => now >= getMatchEndsAt(match);

/**
 * CEO batch 5, item 1: everything the "Delete my account" summary shows, and the blockers that stop it.
 * Runs inside the confirm transaction too, so the checks the player saw are the checks that are applied.
 */
export async function buildDeletionPreview(
  db: Db,
  userId: string,
  now = new Date(),
  teamWallets = new TeamWalletRepository(),
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
  const participations = await db.matchParticipant.findMany({
    where: { userId, status: 'JOINED', match: { status: { notIn: [...FINISHED] } } },
    select: {
      payment: { select: { amountCents: true } },
      match: {
        select: { id: true, name: true, startsAt: true, durationMinutes: true, goNoGoAt: true, mode: true, otherSideMode: true },
      },
    },
  });
  for (const { match, payment } of participations) {
    if (ended(match, now) || (match.mode === 'TEAM_MATCH' && !match.otherSideMode)) continue;
    if (lockedNow(match, now)) {
      block('MATCH_LOCKED', `You are in "${match.name}", which is locked or being played. You can delete your account once it has finished.`, `/matches/${match.id}`);
      continue;
    }
    const paid = payment?.amountCents ?? 0;
    const creditCents = paid ? getCancellationCreditCents(paid, match.startsAt, now) ?? 0 : 0;
    matches.push({
      matchId: match.id,
      name: match.name,
      startsAt: match.startsAt.toISOString(),
      outcome: !paid ? 'NOTHING_PAID' : creditCents === paid ? 'FULL_REFUND' : 'NO_REFUND_UNLESS_REPLACED',
      creditCents,
    });
  }

  const selections = await db.teamMatchSelection.findMany({
    where: { userId, status: { in: [...ACTIVE_SELECTIONS] }, matchTeam: { match: { status: { notIn: [...FINISHED] } } } },
    select: { matchTeam: { select: { match: { select: { id: true, name: true, startsAt: true, durationMinutes: true, goNoGoAt: true } } } } },
  });
  for (const { matchTeam: { match } } of selections) {
    if (ended(match, now)) continue;
    if (lockedNow(match, now)) {
      block('MATCH_LOCKED', `You are in your Team's lineup for "${match.name}", which is locked or being played. You can delete your account once it has finished.`, `/matches/${match.id}`);
      continue;
    }
    matches.push({ matchId: match.id, name: match.name, startsAt: match.startsAt.toISOString(), outcome: 'LEFT_OUT_OF_SQUAD', creditCents: 0 });
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
      block('HOSTING_MATCH', `You are hosting "${match.name}" and other players have joined. Cancel it (everyone is refunded) or wait until it has been played.`, `/matches/${match.id}`);
    else
      matches.push({ matchId: match.id, name: match.name, startsAt: match.startsAt.toISOString(), outcome: 'HOSTED_MATCH_CANCELLED', creditCents: 0 });
  }

  const teams: AccountDeletionTeamPlan[] = [];
  const memberships = await db.teamMembership.findMany({
    where: { userId, team: { archivedAt: null } },
    select: { role: true, team: { select: { id: true, name: true, ownerUserId: true, _count: { select: { memberships: true } } } } },
  });
  for (const { role, team } of memberships) {
    if (team.ownerUserId !== userId) {
      teams.push({ teamId: team.id, name: team.name, role, outcome: 'LEAVE', unspentContributionCents: 0 });
      continue;
    }
    const wallet = await teamWallets.summary(db, team.id);
    const upcoming = await db.match.count({
      where: { teamSides: { some: { teamId: team.id } }, visibility: 'PUBLIC', status: { in: ['OPEN', 'READY', 'IN_PROGRESS', 'AWAITING_RESULT'] } },
    });
    const path = `/teams/${team.id}`;
    if (team._count.memberships > 1)
      block('TEAM_OWNER_HAS_MEMBERS', `You own ${team.name}, which has other members. Make a Captain the Owner, or close the team.`, path);
    else if (wallet.balanceCents > 0)
      block('TEAM_OWNER_HAS_MONEY', `You own ${team.name}, and its Team Wallet holds ${formatRands(wallet.balanceCents)}. Close the team to return everyone's unspent money.`, path);
    else if (upcoming)
      block('TEAM_OWNER_UPCOMING_MATCH', `You own ${team.name}, which has an upcoming Team Match. Cancel it or wait until it has been played.`, path);
    teams.push({ teamId: team.id, name: team.name, role: 'OWNER', outcome: 'CLOSE', unspentContributionCents: 0 });
  }

  let teamContributionsCents = 0;
  const contributedAccounts = await db.teamWalletAccount.findMany({
    where: { transactions: { some: { contributorUserId: userId, type: 'CONTRIBUTION_CREDIT' } } },
    select: { id: true, team: { select: { id: true, name: true } } },
  });
  for (const account of contributedAccounts) {
    const unspent = (await teamWallets.unspentContributions(db, account.id, userId))
      .reduce((sum, row) => sum + row.unspentCents, 0);
    if (!unspent) continue;
    teamContributionsCents += unspent;
    const plan = teams.find(({ teamId }) => teamId === account.team.id);
    if (plan) plan.unspentContributionCents = unspent;
    else teams.push({ teamId: account.team.id, name: account.team.name, role: 'FORMER_MEMBER', outcome: 'LEAVE', unspentContributionCents: unspent });
  }

  const walletAccount = await db.walletAccount.findUnique({ where: { userId } });
  const balanceCents = walletAccount?.balanceCents ?? 0;
  const held = walletAccount
    ? await db.walletHold.aggregate({
        where: { walletAccountId: walletAccount.id, status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        _sum: { amountCents: true },
      })
    : null;
  if (balanceCents < 0 || walletAccount?.spendingRestrictedAt)
    block('NEGATIVE_BALANCE', 'Your wallet is below zero or paused because of a disputed payment. This must be settled first.', '/wallet');
  const [openDisputes, refundsInProgress, pendingTopUps, paidWith] = await Promise.all([
    db.providerDispute.count({ where: { status: 'OPEN', providerPayment: { userId } } }),
    db.providerRefund.count({ where: { status: { in: [...REFUND_IN_PROGRESS_STATUSES] }, providerPayment: { userId } } }),
    db.providerPayment.count({ where: { userId, status: { in: ['INITIALIZED', 'REVIEW'] } } }),
    db.providerPayment.findMany({ where: { userId, status: 'SUCCEEDED', channel: { not: null } }, distinct: ['channel'], select: { channel: true } }),
  ]);
  if (openDisputes)
    block('OPEN_DISPUTE', 'A payment of yours is disputed with your bank (a chargeback). It must be resolved first.', '/wallet');
  if (refundsInProgress)
    block('REFUND_IN_PROGRESS', 'A refund to your card or bank account is still in progress. Wait until it is finished, or contact support.', '/wallet');
  if (pendingTopUps)
    block('TOP_UP_PENDING', 'A top-up is still being confirmed with Paystack. Try again once it has been credited or closed (within 24 hours).', '/wallet');

  matches.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return {
    canDelete: blockers.length === 0,
    blockers,
    matches,
    teams,
    wallet: {
      balanceCents,
      heldCents: held?._sum.amountCents ?? 0,
      teamContributionsCents,
      paymentMethods: paidWith.map(({ channel }) => channel!),
    },
    graceDays: ACCOUNT_DELETION_GRACE_DAYS,
    scheduledFor: deletionScheduledFor(now).toISOString(),
  };
}
