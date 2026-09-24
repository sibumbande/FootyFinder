import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';
import { MatchesRepository, TeamFullError } from '../src/modules/matches/matches.repository.js';

const marker = `phase-1a-${randomUUID()}`;
const repository = new MatchesRepository();

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

const venue = (suffix: string) => ({
  name: `${marker}-${suffix}`,
  addressLine1: '1 Smoke Test Road',
  city: 'Johannesburg',
  region: 'Gauteng',
  countryCode: 'ZA',
});

async function createMatch(
  hostId: string,
  suffix: string,
  startsAt: Date,
  feeCents: number,
  substituteCapacityPerTeam = 5,
) {
  return repository.create(
    {
      name: `${marker}-${suffix}`,
      format: 'FIVE_A_SIDE',
      substituteCapacityPerTeam,
      rollingSubstitutes: true,
      rules: ['GOALKEEPERS_SWAP_AFTER_EVERY_GOAL'],
      visibility: 'PRIVATE',
      startsAt: startsAt.toISOString(),
      feeCents,
      venue: venue(suffix),
    },
    hostId,
    50,
    randomUUID(),
  );
}

async function walletBalance(userId: string) {
  return (await prisma.walletAccount.findUniqueOrThrow({ where: { userId } })).balanceCents;
}

async function main() {
  const users = await Promise.all(Array.from({ length: 9 }, (_, index) => createUser(index)));
  const host = users[0];

  const persisted = await createMatch(
    host.id,
    'persisted-rules',
    new Date(Date.now() + 24 * 60 * 60 * 1_000),
    0,
    10,
  );
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
        venueId: persisted.venueId,
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

  const fullMatch = await createMatch(
    host.id,
    'zero-substitutes',
    new Date(Date.now() + 24 * 60 * 60 * 1_000),
    0,
    0,
  );
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

  const policyNow = new Date();
  const earlyMatch = await createMatch(
    host.id,
    'early-cancellation',
    new Date(policyNow.getTime() + 13 * 60 * 60 * 1_000),
    8_000,
  );
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

  const boundaryMatch = await createMatch(
    host.id,
    'boundary-cancellation',
    new Date(policyNow.getTime() + 12 * 60 * 60 * 1_000),
    8_000,
  );
  await repository.join(boundaryMatch.id, users[7].id, { team: 'AWAY' }, randomUUID());
  const boundaryDebitBalance = await walletBalance(users[7].id);
  const boundaryCancellation = await repository.cancelParticipation(
    boundaryMatch.id,
    users[7].id,
    policyNow,
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
  if (matchIds.length) await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  if (venueIds.length) await prisma.venue.deleteMany({ where: { id: { in: venueIds } } });
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
