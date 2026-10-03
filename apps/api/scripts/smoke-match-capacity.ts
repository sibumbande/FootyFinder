import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';
import { BookingsService } from '../src/modules/bookings/bookings.service.js';
import { managedVenueFixture } from './managed-venue-fixture.js';
import { buyTicket, removeTicketRows } from './support/ticket-fixtures.js';

const marker = `phase-1a-${randomUUID()}`;
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
      emailVerifiedAt: new Date(),
      onboardingCompletedAt: new Date(),
      profile: { create: { displayName: `Capacity ${index}`, onboardingStatus: 'COMPLETE', gender: 'MALE' } },
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

async function main() {
  const users = await Promise.all(Array.from({ length: 6 }, (_, index) => createUser(index)));
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
  // DEC-021: a full side refuses a ticket before any payment starts.
  const fullTeam = await buyTicket(fullMatch.id, users[5].id, 'HOME').then(() => 'OK', (error: { code?: string }) => error.code);
  assert(fullTeam === 'SIDE_FULL', `A player bought a place on a full zero-substitute team (${fullTeam}).`);
  assert((await buyTicket(fullMatch.id, users[5].id, 'AWAY')).participant.team === 'AWAY', 'The other side did not take the player.');

  console.log('Phase 1A PostgreSQL smoke test passed.');
}

async function cleanup() {
  const matches = await prisma.match.findMany({
    where: { name: { startsWith: marker } },
    select: { id: true, venueId: true },
  });
  const matchIds = matches.map(({ id }) => id);
  const venueIds = matches.map(({ venueId }) => venueId);
  await removeTicketRows(matchIds);
  await venueFixture.cleanupMatches(matchIds);
  if (matchIds.length) await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  if (venueIds.length) await prisma.venue.deleteMany({ where: { id: { in: venueIds } } });
  await venueFixture.cleanupVenue();
  await prisma.notification.deleteMany({ where: { user: { email: { startsWith: marker } } } });
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
