import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { getDefaultFormationKey } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { serializableTransaction } from '../src/database/transaction.js';
import { TeamWalletInsufficientFundsError, TeamWalletRepository } from '../src/modules/team-wallet/team-wallet.repository.js';
import { TeamWalletTransfers } from '../src/modules/team-wallet/team-wallet.transfers.js';
import { TeamsRepository } from '../src/modules/teams/teams.repository.js';
import { FinancialInsufficientFundsError, FinancialRepository } from '../src/modules/wallet/financial.repository.js';
import { WalletReconciliationService } from '../src/modules/wallet/wallet-reconciliation.service.js';
import { deleteTeamWalletFixtures } from './team-wallet-fixtures.js';

/**
 * Gate 7 / TKT-701 on real PostgreSQL: the Team Wallet ledger, holds, oldest-first provenance,
 * closure and reconciliation. Every fixture is tagged with a run marker and removed afterwards.
 */
const marker = `gate7-wallet-${randomUUID()}`;
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const financial = new FinancialRepository();
const teamWallets = new TeamWalletRepository();
const transfers = new TeamWalletTransfers(teamWallets, financial);
const teams = new TeamsRepository(teamWallets, transfers);
const reconciliation = new WalletReconciliationService();
const userIds: string[] = [];
const teamIds: string[] = [];
const matchIds: string[] = [];
const venueIds: string[] = [];

const rejects = async (work: () => Promise<unknown>, check: (error: unknown) => boolean) => {
  try {
    await work();
  } catch (error) {
    return check(error);
  }
  return false;
};
const code = (value: string) => (error: unknown) => (error as { code?: string }).code === value;
const dbError = (text: string) => (error: unknown) => String(error).includes(text);

async function user(index: number, depositCents: number) {
  const created = await prisma.user.create({
    data: {
      email: `${marker}-${index}@smoke.invalid`,
      username: `tw_${marker.slice(-12)}_${index}`,
      passwordHash: 'smoke-test-only',
      profile: { create: { displayName: `Wallet Smoke ${index}` } },
      walletAccount: { create: {} },
    },
  });
  userIds.push(created.id);
  await serializableTransaction((tx) => financial.credit(tx, {
    userId: created.id, amountCents: depositCents, type: 'DEPOSIT_CREDIT',
    idempotencyKey: `${marker}:seed:${index}`, referenceType: 'SMOKE', referenceId: marker,
  }));
  return created;
}

/** Personal debit and team credit in one transaction (the TKT-702 contribution shape). */
const contribute = (teamId: string, userId: string, amountCents: number, key: string) =>
  serializableTransaction(async (tx) => {
    await teamWallets.lockAccount(tx, teamId);
    const personal = await financial.debit(tx, {
      userId, amountCents, type: 'TEAM_CONTRIBUTION_DEBIT', idempotencyKey: `${key}:personal`,
      referenceType: 'TEAM', referenceId: teamId,
    });
    return teamWallets.credit(tx, {
      teamId, amountCents, idempotencyKey: key, contributorUserId: userId,
      linkedWalletTransactionId: personal.transaction.id, referenceType: 'TEAM', referenceId: teamId,
    });
  });

const balanceOf = async (userId: string) => (await prisma.walletAccount.findUniqueOrThrow({ where: { userId } })).balanceCents;
const summary = (teamId: string) => serializableTransaction((tx) => teamWallets.summary(tx, teamId));
const ourIssues = async () => {
  const accounts = await prisma.teamWalletAccount.findMany({ where: { teamId: { in: teamIds } }, select: { id: true } });
  const accountIds = new Set(accounts.map(({ id }) => id));
  const report = await reconciliation.report();
  return report.issues.filter((issue) =>
    (issue.walletAccountId && accountIds.has(issue.walletAccountId))
    || (issue.referenceId && teamIds.includes(issue.referenceId))
    || (issue.userId && userIds.includes(issue.userId)));
};

async function main() {
  const owner = await user(1, 60_000);
  const member = await user(2, 25_000);
  const team = await teams.create({
    name: `${marker}-team`, primaryFormat: 'FIVE_A_SIDE', formationKey: getDefaultFormationKey('FIVE_A_SIDE'),
  }, owner.id);
  teamIds.push(team.id);
  await prisma.teamMembership.create({ data: { teamId: team.id, userId: member.id, role: 'MEMBER' } });
  const venue = await prisma.venue.create({
    data: { name: `${marker}-venue`, addressLine1: '1 Ledger Road', city: 'Cape Town', region: 'Western Cape', countryCode: 'ZA' },
  });
  venueIds.push(venue.id);
  const match = await prisma.match.create({
    data: {
      name: `${marker}-match`, createdById: owner.id, venueId: venue.id, mode: 'TEAM_MATCH', format: 'FIVE_A_SIDE',
      visibility: 'PRIVATE', status: 'DRAFT', startsAt: new Date(Date.now() + 86_400_000), durationMinutes: 60, feeCents: 0,
    },
  });
  matchIds.push(match.id);

  // Every team starts at zero; the wallet is created on first use.
  assert((await summary(team.id)).balanceCents === 0, 'A new team wallet did not start at zero.');

  // Contributions: idempotent, and a reused key with other money facts is refused.
  const first = await contribute(team.id, owner.id, 30_000, `${marker}:c1`);
  const replay = await contribute(team.id, owner.id, 30_000, `${marker}:c1`);
  assert(!first.replayed && replay.replayed, 'A replayed contribution was not idempotent.');
  assert(await rejects(() => contribute(team.id, owner.id, 31_000, `${marker}:c1`), code('FINANCIAL_IDEMPOTENCY_CONFLICT')),
    'A reused contribution key with a different amount was accepted.');
  assert(await balanceOf(owner.id) === 30_000, 'The personal leg of a contribution was applied more than once.');

  // Concurrent contributions never overdraw the personal wallet and never partially apply.
  const racing = await Promise.allSettled(
    Array.from({ length: 4 }, (_, index) => contribute(team.id, member.id, 10_000, `${marker}:race-${index}`)),
  );
  const won = racing.filter((result) => result.status === 'fulfilled').length;
  assert(won === 2, `Expected exactly two of four R100 contributions from R250 to succeed, got ${won}.`);
  assert(racing.every((result) => result.status === 'fulfilled' || result.reason instanceof FinancialInsufficientFundsError),
    'A losing concurrent contribution failed for the wrong reason.');
  assert(await balanceOf(member.id) === 5_000, 'Concurrent contributions left the personal wallet inconsistent.');
  let wallet = await summary(team.id);
  assert(wallet.balanceCents === 50_000, `Team wallet should hold R500, has ${wallet.balanceCents}.`);

  // Holds reduce the available balance; concurrent holds cannot overcommit it.
  const holds = await Promise.allSettled([35_000, 35_000].map((amountCents, index) =>
    serializableTransaction((tx) => teamWallets.createHold(tx, {
      teamId: team.id, matchId: match.id, side: 'HOME', amountCents, idempotencyKey: `${marker}:hold-${index}`, createdByUserId: owner.id,
    }))));
  assert(holds.filter((result) => result.status === 'fulfilled').length === 1, 'Concurrent team holds overcommitted the wallet.');
  assert(holds.some((result) => result.status === 'rejected' && result.reason instanceof TeamWalletInsufficientFundsError),
    'A losing team hold failed for the wrong reason.');
  const hold = (holds.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<{ hold: { id: string } }>).value.hold;
  wallet = await summary(team.id);
  assert(wallet.heldCents === 35_000 && wallet.availableCents === 15_000, 'Held and available team balances are wrong.');

  // A member cannot self-refund held money or more than their own unspent contributions.
  const refund = (amountCents: number, key: string) => serializableTransaction((tx) => transfers.refundContributor(tx, {
    teamId: team.id, teamName: team.name, contributorUserId: member.id, amountCents,
    type: 'CONTRIBUTION_REFUND_DEBIT', idempotencyKey: key, actorUserId: member.id,
  }));
  assert(await rejects(() => refund(16_000, `${marker}:refund-too-much`), code('TEAM_WALLET_INSUFFICIENT_FUNDS')),
    'A refund of held team money was allowed.');
  await refund(5_000, `${marker}:refund-1`);
  await refund(5_000, `${marker}:refund-1`);
  assert(await balanceOf(member.id) === 10_000, 'A member self-refund was not applied exactly once.');

  // Capture spends contributions oldest first (the owner's R300 before the member's R100s).
  const capture = await serializableTransaction((tx) => teamWallets.captureHold(tx, hold.id, { idempotencyKey: `${marker}:capture` }));
  const captureReplay = await serializableTransaction((tx) => teamWallets.captureHold(tx, hold.id, { idempotencyKey: `${marker}:capture` }));
  assert(!capture.replayed && captureReplay.replayed, 'Capturing a team hold was not idempotent.');
  const allocations = await prisma.teamWalletAllocation.findMany({
    where: { debitTransactionId: capture.transaction.id },
    include: { contribution: { select: { contributorUserId: true } } },
  });
  const spentFromOwner = allocations.filter((row) => row.contribution.contributorUserId === owner.id).reduce((sum, row) => sum + row.amountCents, 0);
  assert(spentFromOwner === 30_000 && allocations.reduce((sum, row) => sum + row.amountCents, 0) === 35_000,
    'Capture did not spend the oldest contributions first.');
  wallet = await summary(team.id);
  assert(wallet.balanceCents === 10_000 && wallet.heldCents === 0, 'Team balance after capture is wrong.');
  assert(await rejects(() => serializableTransaction((tx) => teamWallets.releaseHold(tx, hold.id, 'smoke')), code('TEAM_WALLET_HOLD_CAPTURED')),
    'A captured team hold was released.');

  // The database refuses direct edits.
  assert(await rejects(() => prisma.teamWalletTransaction.update({ where: { id: capture.transaction.id }, data: { amountCents: -1 } }), dbError('immutable')),
    'The database allowed a team ledger row to be edited.');
  assert(await rejects(() => prisma.teamWalletAccount.update({ where: { teamId: team.id }, data: { balanceCents: -1 } }), dbError('TeamWalletAccount_nonnegative_balance')),
    'The database allowed a negative team balance.');
  assert(await rejects(() => prisma.teamWalletHold.update({ where: { id: hold.id }, data: { status: 'RELEASED', releasedAt: new Date(), capturedAt: null, captureTransactionId: null, releaseReason: 'x' } }), dbError('immutable')),
    'The database allowed a captured team hold to be reversed.');
  const ownerContribution = await prisma.teamWalletTransaction.findUniqueOrThrow({ where: { idempotencyKey: `${marker}:c1` } });
  assert(await rejects(() => prisma.teamWalletAllocation.create({ data: { contributionTransactionId: ownerContribution.id, debitTransactionId: capture.transaction.id, amountCents: 1 } }), dbError('')),
    'The database allowed a contribution to be spent twice.');

  assert((await ourIssues()).length === 0, `Reconciliation found issues on clean fixtures: ${JSON.stringify(await ourIssues())}`);

  // Injected inconsistencies are detected, then repaired.
  const account = await prisma.teamWalletAccount.findUniqueOrThrow({ where: { teamId: team.id } });
  await prisma.teamWalletAccount.update({ where: { id: account.id }, data: { balanceCents: { increment: 100 } } });
  let issues = await ourIssues();
  assert(issues.some((issue) => issue.code === 'TEAM_BALANCE_LEDGER_MISMATCH'), 'A team balance/ledger mismatch was not detected.');
  assert(issues.some((issue) => issue.code === 'TEAM_PROVENANCE_MISMATCH'), 'A provenance mismatch was not detected.');
  await prisma.teamWalletAccount.update({ where: { id: account.id }, data: { balanceCents: { decrement: 100 } } });
  const orphan = await serializableTransaction((tx) => financial.debit(tx, {
    userId: member.id, amountCents: 1_000, type: 'TEAM_CONTRIBUTION_DEBIT', idempotencyKey: `${marker}:orphan`, referenceType: 'TEAM', referenceId: team.id,
  }));
  issues = await ourIssues();
  assert(issues.some((issue) => issue.code === 'TEAM_CONTRIBUTION_LINK_MISMATCH' && issue.referenceId === orphan.transaction.id),
    'A personal contribution without a team row was not detected.');
  await prisma.walletTransaction.delete({ where: { id: orphan.transaction.id } });
  await prisma.walletAccount.update({ where: { userId: member.id }, data: { balanceCents: { increment: 1_000 } } });
  assert((await ourIssues()).length === 0, 'Repaired fixtures still reported issues.');

  // Closure is blocked while money is held, then returns each member's own unspent money.
  const blocking = await serializableTransaction((tx) => teamWallets.createHold(tx, {
    teamId: team.id, matchId: match.id, side: 'HOME', amountCents: 1_000, idempotencyKey: `${marker}:blocking-hold`, createdByUserId: owner.id,
  }));
  assert((await teams.close(team.id, owner.id)).outcome === 'HOLDS_ACTIVE', 'A team with held money was closed.');
  await serializableTransaction((tx) => teamWallets.releaseHold(tx, blocking.hold.id, 'smoke'));
  const released = await serializableTransaction((tx) => teamWallets.releaseHold(tx, blocking.hold.id, 'smoke'));
  assert(released.replayed, 'Releasing a team hold twice was not idempotent.');
  const unspent = await serializableTransaction((tx) => teamWallets.unspentByContributor(tx, account.id));
  assert(unspent.get(member.id) === 10_000 && !unspent.has(owner.id), 'Unspent contributions per member are wrong.');
  const memberBefore = await balanceOf(member.id);
  const closed = await teams.close(team.id, owner.id);
  assert(closed.outcome === 'CLOSED' && closed.refunds.length === 1, 'Team closure did not refund the one member with unspent money.');
  assert(await balanceOf(member.id) === memberBefore + 10_000, 'Closure did not return the member\'s unspent contributions.');
  assert((await summary(team.id)).balanceCents === 0, 'A closed team still holds money.');
  assert((await prisma.team.findUniqueOrThrow({ where: { id: team.id } })).archivedAt, 'A closed team was not archived.');
  assert((await teams.close(team.id, owner.id)).outcome === 'ALREADY_CLOSED', 'Closing twice was not idempotent.');
  assert(await prisma.notification.count({ where: { userId: member.id, type: 'WALLET_CREDIT' } }) === 1, 'The closure refund notice was not sent exactly once.');
  assert((await ourIssues()).length === 0, 'Reconciliation found issues after closure.');

  await prisma.teamWalletAccount.update({ where: { id: account.id }, data: { balanceCents: 100 } });
  assert((await ourIssues()).some((issue) => issue.code === 'TEAM_ARCHIVED_WITH_FUNDS'), 'Money in a closed team was not detected.');
  await prisma.teamWalletAccount.update({ where: { id: account.id }, data: { balanceCents: 0 } });
  console.log('Gate 7 team-wallet smoke passed.');
}

try {
  await main();
} finally {
  await deleteTeamWalletFixtures(teamIds);
  await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  await prisma.venue.deleteMany({ where: { id: { in: venueIds } } });
  await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.walletTransaction.deleteMany({ where: { walletAccount: { userId: { in: userIds } } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  assert((await prisma.user.count({ where: { email: { startsWith: marker } } })) === 0, 'Team-wallet smoke users remained.');
  await prisma.$disconnect();
}
