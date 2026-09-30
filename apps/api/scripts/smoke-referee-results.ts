import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';
import { serializableTransaction } from '../src/database/transaction.js';
import { BookingsService } from '../src/modules/bookings/bookings.service.js';
import { recordKickoffLineup } from '../src/modules/matches/lineup-record.js';
import { transitionMatchToStarted } from '../src/modules/matches/match-lifecycle.scheduler.js';
import { MatchesRepository } from '../src/modules/matches/matches.repository.js';
import { MatchesService } from '../src/modules/matches/matches.service.js';
import { FinancialRepository } from '../src/modules/wallet/financial.repository.js';
import { managedVenueFixture } from './managed-venue-fixture.js';
import { refereeFixture } from './referee-fixture.js';

/**
 * Gate 8 smoke (DEC-020): the kickoff lineup record (TKT-803). Team sides are covered in
 * smoke:team-go-no-go.
 */
const marker = `g8-results-${randomUUID().slice(0, 8)}`;
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const bookings = new BookingsService();
const repository = new MatchesRepository();
const matches = new MatchesService();
const financial = new FinancialRepository();
const venue = managedVenueFixture(marker);
const referee = refereeFixture(marker);
const userIds: string[] = [];
const matchIds: string[] = [];

const user = async (label: string) => {
  const created = await prisma.user.create({
    data: {
      email: `${marker}-${label}@smoke.invalid`,
      username: `${marker.slice(-8)}_${label}`,
      passwordHash: 'smoke-test-only',
      emailVerifiedAt: new Date(),
      onboardingCompletedAt: new Date(),
      profile: { create: { displayName: `Player ${label}` } },
      walletAccount: { create: { currency: 'ZAR' } },
    },
  });
  userIds.push(created.id);
  await serializableTransaction((tx) =>
    financial.credit(tx, { userId: created.id, amountCents: 50_000, type: 'DEPOSIT_CREDIT', idempotencyKey: `${marker}:seed:${label}`, referenceType: 'SMOKE', referenceId: marker }),
  );
  return created;
};

/**
 * A confirmed Quick Match that has kicked off: every position claimed (5 a side) plus one
 * substitute per side, a referee assigned, the T-30 check passed, then kickoff.
 */
async function playedQuickMatch(label: string, host: { id: string }, players: Array<{ id: string }>) {
  const created = await bookings.createQuickMatch(
    { managedFieldId: venue.fieldId, name: `${marker}-${label}`, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 5, rollingSubstitutes: false, rules: [], visibility: 'PUBLIC', startsAt: venue.nextKickoff().toISOString() },
    host.id,
  );
  matchIds.push(created.id);
  await referee.assign(created.id);
  const slots = await prisma.formationSlot.findMany({ where: { matchId: created.id }, orderBy: [{ team: 'asc' }, { slotIndex: 'asc' }] });
  for (const [index, player] of players.entries()) {
    const slot = slots[index];
    const team = slot?.team ?? (index % 2 === 0 ? 'HOME' : 'AWAY');
    await repository.join(created.id, player.id, { team }, `${marker}:join:${created.id}:${player.id}`);
    if (slot) await repository.claimPosition(created.id, slot.id, player.id);
  }
  const record = await prisma.match.findUniqueOrThrow({ where: { id: created.id } });
  assert((await matches.decideGoNoGo(created.id, record.goNoGoAt!)).outcome === 'CONFIRMED', 'The full refereed match was not confirmed.');
  // Pretend kickoff has arrived.
  const startsAt = new Date(Date.now() - 60_000);
  await prisma.match.update({ where: { id: created.id }, data: { startsAt, goNoGoAt: new Date(startsAt.getTime() - 30 * 60_000) } });
  assert(await transitionMatchToStarted(created.id), 'The match did not kick off.');
  return created.id;
}

async function main() {
  await venue.create();
  const host = await user('host');
  const players = [];
  for (let index = 0; index < 12; index += 1) players.push(await user(`p${index}`));

  // TKT-803: kickoff writes one permanent entry per player: position holders start, others are subs.
  const matchId = await playedQuickMatch('lineup', host, players);
  const lineup = await prisma.matchLineupEntry.findMany({ where: { matchId } });
  assert(lineup.length === 12, `Expected 12 lineup entries, found ${lineup.length}.`);
  assert(lineup.filter(({ role }) => role === 'STARTER').length === 10 && lineup.filter(({ role }) => role === 'SUBSTITUTE').length === 2, 'Starters and substitutes were not recorded correctly.');
  assert(lineup.every(({ source, teamId }) => source === 'PARTICIPANT' && teamId === null), 'Quick Match entries were not recorded as participants.');
  assert(lineup.every(({ displayNameSnapshot }) => displayNameSnapshot.startsWith('Player ')), 'Display names were not snapshotted.');
  assert(!lineup.some(({ userId }) => userId === host.id), 'The host was recorded without joining.');
  assert(!(await transitionMatchToStarted(matchId)), 'Kickoff ran twice.');
  assert((await serializableTransaction((tx) => recordKickoffLineup(tx, matchId))) === 0, 'The lineup record was written twice.');
  let permanent = false;
  try {
    await prisma.$executeRaw`UPDATE "MatchLineupEntry" SET "role" = 'SUBSTITUTE' WHERE "matchId" = ${matchId}::uuid`;
  } catch (error) {
    permanent = String(error).includes('the kickoff lineup record is permanent');
  }
  assert(permanent, 'The kickoff lineup record could be edited.');
  const flagged = await prisma.matchLineupEntry.updateMany({ where: { matchId, userId: players[11]!.id }, data: { didNotPlay: true } });
  assert(flagged.count === 1, 'didNotPlay could not be set.');

  console.log('Gate 8 referee results smoke passed: kickoff lineup record (starters, substitutes, snapshots, once, permanent except didNotPlay).');
}

async function cleanup() {
  await referee.cleanupJobs(matchIds);
  await venue.cleanupMatches(matchIds);
  await prisma.matchPayment.deleteMany({ where: { matchId: { in: matchIds } } });
  const venueIds = (await prisma.match.findMany({ where: { id: { in: matchIds } }, select: { venueId: true } })).map(({ venueId }) => venueId);
  await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  await prisma.venue.deleteMany({ where: { id: { in: venueIds } } });
  await venue.cleanupVenue();
  await referee.cleanup();
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.walletHold.deleteMany({ where: { walletAccount: { userId: { in: userIds } } } });
  await prisma.walletTransaction.deleteMany({ where: { walletAccount: { userId: { in: userIds } } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

try {
  await main();
} finally {
  await cleanup().catch((error: unknown) => {
    console.error('Cleanup failed:', error);
    process.exitCode = 1;
  });
  await prisma.$disconnect();
}
