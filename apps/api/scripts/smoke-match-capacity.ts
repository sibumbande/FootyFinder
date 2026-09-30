import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';
import { BookingsService } from '../src/modules/bookings/bookings.service.js';
import { MatchesRepository, TeamFullError } from '../src/modules/matches/matches.repository.js';
import { managedVenueFixture } from './managed-venue-fixture.js';

const marker = `phase-1a-${randomUUID()}`;
const repository = new MatchesRepository();
const bookings = new BookingsService();
const venueFixture = managedVenueFixture(marker);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function createUser(index: number) {
  return prisma.user.create({
    data: {
      email: `${marker}-${index}@smoke.invalid`,
      username: `${marker.slice(0, 18)}-${index}`,
      passwordHash: 'smoke-test-only',
      walletAccount: { create: { balanceCents: 100_000, currency: 'ZAR' } },
    },
  });
}

/**
 * A private Quick Match on a managed slot (the only way to create one since Gate 3). DEC-018: the
 * fee is always the platform-fixed R80; hosts cannot set it.
 */
async function createMatch(hostId: string, suffix: string, startsAt: Date, substituteCapacityPerTeam = 5) {
  return bookings.createQuickMatch(
    {
      managedFieldId: venueFixture.fieldId,
      name: `${marker}-${suffix}`,
      format: 'FIVE_A_SIDE',
      substituteCapacityPerTeam,
      rollingSubstitutes: true,
      rules: ['GOALKEEPERS_SWAP_AFTER_EVERY_GOAL'],
      visibility: 'PRIVATE',
      startsAt: startsAt.toISOString(),
    },
    hostId,
  );
}

async function walletBalance(userId: string) {
  return (await prisma.walletAccount.findUniqueOrThrow({ where: { userId } })).balanceCents;
}

async function main() {
  const users = await Promise.all(Array.from({ length: 9 }, (_, index) => createUser(index)));
  const host = users[0];
  await venueFixture.create();

  const persisted = await createMatch(host.id, 'persisted-rules', venueFixture.nextKickoff(), 10);
  assert(persisted.feeCents === 8_000, 'A Quick Match did not use the fixed R80 fee (DEC-018).');
  assert(persisted.substituteCapacityPerTeam === 10, 'Substitute capacity was not persisted.');
  assert(persisted.rollingSubstitutes, 'Rolling-substitute setting was not persisted.');
  assert(
    persisted.rules.includes('GOALKEEPERS_SWAP_AFTER_EVERY_GOAL'),
    'Informational rules were not persisted.',
  );

  let constraintRejected = false;
  try {
    await prisma.match.create({
      data: {
        name: `${marker}-invalid-capacity`,
        createdById: host.id,
        venueId: (await prisma.match.findUniqueOrThrow({ where: { id: persisted.id } })).venueId,
        format: 'FIVE_A_SIDE',
        substituteCapacityPerTeam: 11,
        visibility: 'PRIVATE',
        startsAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
        durationMinutes: 50,
        feeCents: 0,
      },
    });
  } catch {
    constraintRejected = true;
  }
  assert(constraintRejected, 'The database accepted more than ten substitutes per team.');

  const fullMatch = await createMatch(host.id, 'zero-substitutes', venueFixture.nextKickoff(), 0);
  await prisma.matchParticipant.createMany({
    data: users.slice(0, 5).map((user) => ({
      matchId: fullMatch.id,
      userId: user.id,
      team: 'HOME',
    })),
  });
  let fullTeamRejected = false;
  try {
    await repository.join(fullMatch.id, users[5].id, { team: 'HOME' }, randomUUID());
  } catch (error) {
    fullTeamRejected = error instanceof TeamFullError;
  }
  assert(fullTeamRejected, 'A player joined a full zero-substitute team.');

  // Kickoffs must sit on the venue's 30-minute grid, so the leave policy is evaluated at an
  // explicit instant: 13 hours before kickoff (full credit) and exactly 12 hours (none).
  const earlyKickoff = venueFixture.nextKickoff();
  const policyNow = new Date(earlyKickoff.getTime() - 13 * 60 * 60 * 1_000);
  const earlyMatch = await createMatch(host.id, 'early-cancellation', earlyKickoff);
  await repository.join(earlyMatch.id, users[6].id, { team: 'HOME' }, randomUUID());
  const earlyDebitBalance = await walletBalance(users[6].id);
  const earlyCancellation = await repository.cancelParticipation(
    earlyMatch.id,
    users[6].id,
    policyNow,
  );
  assert(
    earlyCancellation.cancellation?.initialCreditCents === 8_000,
    'Early credit was not full.',
  );
  assert((await walletBalance(users[6].id)) === earlyDebitBalance + 8_000, 'Early credit missing.');
  await repository.cancelParticipation(earlyMatch.id, users[6].id, policyNow);
  assert(
    (await walletBalance(users[6].id)) === earlyDebitBalance + 8_000,
    'Cancellation replay credited the wallet twice.',
  );

  const boundaryKickoff = venueFixture.nextKickoff();
  const boundaryNow = new Date(boundaryKickoff.getTime() - 12 * 60 * 60 * 1_000);
  const boundaryMatch = await createMatch(host.id, 'boundary-cancellation', boundaryKickoff);
  await repository.join(boundaryMatch.id, users[7].id, { team: 'AWAY' }, randomUUID());
  const boundaryDebitBalance = await walletBalance(users[7].id);
  const boundaryCancellation = await repository.cancelParticipation(
    boundaryMatch.id,
    users[7].id,
    boundaryNow,
  );
  assert(
    boundaryCancellation.cancellation?.initialCreditCents === 0,
    'Exactly twelve hours should not issue an initial credit.',
  );
  assert(
    (await walletBalance(users[7].id)) === boundaryDebitBalance,
    'Boundary cancellation changed the wallet before replacement.',
  );
  const replacementKey = randomUUID();
  await repository.join(boundaryMatch.id, users[8].id, { team: 'AWAY' }, replacementKey);
  assert(
    (await walletBalance(users[7].id)) === boundaryDebitBalance + 8_000,
    'Confirmed replacement did not release the withheld credit.',
  );
  await repository.join(boundaryMatch.id, users[8].id, { team: 'AWAY' }, replacementKey);
  assert(
    (await walletBalance(users[7].id)) === boundaryDebitBalance + 8_000,
    'Replacement replay credited the original player twice.',
  );

  console.log('Phase 1A PostgreSQL smoke test passed.');
}

async function cleanup() {
  const matches = await prisma.match.findMany({
    where: { name: { startsWith: marker } },
    select: { id: true, venueId: true },
  });
  const matchIds = matches.map(({ id }) => id);
  const venueIds = matches.map(({ venueId }) => venueId);
  await venueFixture.cleanupMatches(matchIds);
  if (matchIds.length) await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  if (venueIds.length) await prisma.venue.deleteMany({ where: { id: { in: venueIds } } });
  await venueFixture.cleanupVenue();
  await prisma.notification.deleteMany({ where: { user: { email: { startsWith: marker } } } });
  await prisma.walletTransaction.deleteMany({ where: { walletAccount: { user: { email: { startsWith: marker } } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: marker } } });
  const [remainingMatches, remainingVenues, remainingUsers] = await Promise.all([
    prisma.match.count({ where: { name: { startsWith: marker } } }),
    prisma.venue.count({ where: { name: { startsWith: marker } } }),
    prisma.user.count({ where: { email: { startsWith: marker } } }),
  ]);
  assert(
    remainingMatches + remainingVenues + remainingUsers === 0,
    'Smoke-test cleanup left marked rows behind.',
  );
}

try {
  await main();
} finally {
  await cleanup();
  await prisma.$disconnect();
}
