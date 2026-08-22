import { randomUUID } from 'node:crypto';
import { getDefaultFormationKey } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { MatchAvailabilityService } from '../src/modules/match-availability/match-availability.service.js';
import { MatchesRepository } from '../src/modules/matches/matches.repository.js';
import { TeamsRepository } from '../src/modules/teams/teams.repository.js';

const marker = `phase-1c-${randomUUID()}`;
const matches = new MatchesRepository();
const teams = new TeamsRepository();
const availability = new MatchAvailabilityService();

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

const fixtureInput = (suffix: string) => ({
  name: `${marker}-${suffix}`,
  format: 'FIVE_A_SIDE' as const,
  substituteCapacityPerTeam: 5,
  rollingSubstitutes: true,
  rules: ['GOALKEEPERS_SWAP_AFTER_EVERY_GOAL'] as Array<'GOALKEEPERS_SWAP_AFTER_EVERY_GOAL'>,
  startsAt: new Date(Date.now() + 86_400_000).toISOString(),
  formationKey: getDefaultFormationKey('FIVE_A_SIDE'),
  venue: {
    name: `${marker}-${suffix}-venue`,
    addressLine1: '1 Availability Road',
    city: 'Johannesburg',
    region: 'Gauteng',
    countryCode: 'ZA',
  },
});

async function main() {
  const [owner, captain, member, newcomer, outsider] = await Promise.all(
    Array.from({ length: 5 }, (_, index) => createUser(index)),
  );
  const team = await teams.create(
    {
      name: `${marker}-team`,
      shortName: 'P1C',
      primaryFormat: 'FIVE_A_SIDE',
      formationKey: getDefaultFormationKey('FIVE_A_SIDE'),
    },
    owner.id,
  );
  await prisma.teamMembership.createMany({
    data: [
      { teamId: team.id, userId: captain.id, role: 'CAPTAIN' },
      { teamId: team.id, userId: member.id, role: 'MEMBER' },
    ],
  });
  const fixture = await matches.createTeamFixture(team.id, fixtureInput('primary'), owner.id, 90);
  const quickMatch = await matches.create(
    { ...fixtureInput('quick-game'), visibility: 'PUBLIC', feeCents: 0 },
    owner.id,
    90,
  );
  let quickGameRejected = false;
  try {
    await availability.get(quickMatch.id, 'HOME', {}, owner.id);
  } catch (error) {
    quickGameRejected =
      error instanceof Error && 'code' in error && error.code === 'TEAM_MATCH_SIDE_NOT_FOUND';
  }
  assert(quickGameRejected, 'Quick Game entered Team availability.');

  const first = await availability.request(fixture.id, 'HOME', owner.id);
  assert(first.addedMemberCount === 3, 'Initial request did not snapshot the full Squad Pool.');
  assert(first.notifiedMemberCount === 2, 'Initial request notified the requesting actor.');
  assert(
    (await prisma.teamMatchAvailability.count({
      where: { matchTeamId: fixture.teamSides[0]!.id },
    })) === 3,
    'Initial availability rows were not persisted.',
  );

  const repeated = await availability.request(fixture.id, 'HOME', captain.id);
  assert(repeated.addedMemberCount === 0, 'Repeated request added duplicate rows.');
  assert(repeated.notifiedMemberCount === 0, 'Repeated request sent duplicate notifications.');
  let memberRequestForbidden = false;
  try {
    await availability.request(fixture.id, 'HOME', member.id);
  } catch (error) {
    memberRequestForbidden =
      error instanceof Error && 'code' in error && error.code === 'TEAM_FORBIDDEN';
  }
  assert(memberRequestForbidden, 'A MEMBER requested Team availability.');

  const available = await availability.updateMine(
    fixture.id,
    'HOME',
    { status: 'AVAILABLE' },
    member.id,
  );
  assert(Boolean(available.respondedAt), 'A response did not set respondedAt.');
  const memberView = await availability.get(fixture.id, 'HOME', {}, member.id);
  assert(memberView.summary.squadPool === 3, 'Member summary did not include the snapshot.');
  assert(
    memberView.rows.length === 1 && memberView.rows[0]?.userId === member.id,
    'Member saw another player response.',
  );
  const reset = await availability.updateMine(
    fixture.id,
    'HOME',
    { status: 'NO_RESPONSE' },
    member.id,
  );
  assert(!reset.respondedAt, 'NO_RESPONSE did not clear respondedAt.');

  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: newcomer.id, role: 'MEMBER' },
  });
  let notRequested = false;
  try {
    await availability.updateMine(fixture.id, 'HOME', { status: 'MAYBE' }, newcomer.id);
  } catch (error) {
    notRequested =
      error instanceof Error && 'code' in error && error.code === 'AVAILABILITY_NOT_REQUESTED';
  }
  assert(notRequested, 'A newly joined member responded before a repeat request.');
  const expanded = await availability.request(fixture.id, 'HOME', captain.id);
  assert(
    expanded.addedMemberCount === 1 && expanded.notifiedMemberCount === 1,
    'Repeat request did not add and notify only the newcomer.',
  );
  const maybe = await availability.updateMine(fixture.id, 'HOME', { status: 'MAYBE' }, newcomer.id);
  assert(maybe.status === 'MAYBE' && Boolean(maybe.respondedAt), 'MAYBE was not persisted.');

  let wrongSide = false;
  try {
    await availability.get(fixture.id, 'AWAY', {}, captain.id);
  } catch (error) {
    wrongSide =
      error instanceof Error && 'code' in error && error.code === 'TEAM_MATCH_SIDE_NOT_FOUND';
  }
  assert(wrongSide, 'A missing Match side exposed availability.');

  await availability.updateMine(fixture.id, 'HOME', { status: 'UNAVAILABLE' }, member.id);
  await prisma.teamMembership.delete({
    where: { teamId_userId: { teamId: team.id, userId: member.id } },
  });
  let removedForbidden = false;
  try {
    await availability.get(fixture.id, 'HOME', {}, member.id);
  } catch (error) {
    removedForbidden = error instanceof Error && 'code' in error && error.code === 'TEAM_FORBIDDEN';
  }
  assert(removedForbidden, 'Removed member retained availability access.');
  const captainView = await availability.get(fixture.id, 'HOME', {}, captain.id);
  assert(
    captainView.summary.squadPool === 4,
    'Removed member disappeared from the historical snapshot.',
  );
  assert(
    (await availability.get(fixture.id, 'HOME', { selected: true }, captain.id)).rows.length === 0,
    'Phase 1C selected=true returned rows.',
  );
  assert(
    (await availability.get(fixture.id, 'HOME', { selected: false }, captain.id)).rows.length === 4,
    'Phase 1C selected=false omitted rows.',
  );

  let outsiderForbidden = false;
  try {
    await availability.request(fixture.id, 'HOME', outsider.id);
  } catch (error) {
    outsiderForbidden =
      error instanceof Error && 'code' in error && error.code === 'TEAM_FORBIDDEN';
  }
  assert(outsiderForbidden, 'Outsider requested Team availability.');

  const concurrentFixture = await matches.createTeamFixture(
    team.id,
    fixtureInput('concurrent'),
    owner.id,
    90,
  );
  const concurrent = await Promise.all([
    availability.request(concurrentFixture.id, 'HOME', owner.id),
    availability.request(concurrentFixture.id, 'HOME', captain.id),
  ]);
  assert(
    concurrent.reduce((sum, result) => sum + result.addedMemberCount, 0) === 3,
    'Concurrent requests duplicated snapshot work.',
  );
  assert(
    concurrent.reduce((sum, result) => sum + result.notifiedMemberCount, 0) === 2,
    'Concurrent requests duplicated notifications.',
  );
  const concurrentNotifications = await prisma.notification.findMany({
    where: {
      type: 'TEAM_MATCH_AVAILABILITY_REQUESTED',
      targetPath: `/matches/${concurrentFixture.id}`,
    },
  });
  assert(
    concurrentNotifications.length === 2,
    'Concurrent request persisted duplicate notifications.',
  );
  assert(
    new Set(concurrentNotifications.map(({ userId }) => userId)).size === 2,
    'A concurrent recipient was notified twice.',
  );

  await prisma.match.update({ where: { id: fixture.id }, data: { status: 'CANCELLED' } });
  let closed = false;
  try {
    await availability.get(fixture.id, 'HOME', {}, captain.id);
  } catch (error) {
    closed = error instanceof Error && 'code' in error && error.code === 'TEAM_MATCH_CLOSED';
  }
  assert(closed, 'Cancelled fixture exposed availability.');
  console.log('Phase 1C PostgreSQL smoke test passed.');
}

async function cleanup() {
  const markedMatches = await prisma.match.findMany({
    where: { name: { startsWith: marker } },
    select: { id: true, venueId: true },
  });
  const matchIds = markedMatches.map(({ id }) => id);
  if (matchIds.length) await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  const teamIds = (
    await prisma.team.findMany({ where: { name: { startsWith: marker } }, select: { id: true } })
  ).map(({ id }) => id);
  if (teamIds.length) await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
  if (markedMatches.length)
    await prisma.venue.deleteMany({
      where: { id: { in: markedMatches.map(({ venueId }) => venueId) } },
    });
  await prisma.user.deleteMany({ where: { email: { startsWith: marker } } });
  const remaining = await Promise.all([
    prisma.team.count({ where: { name: { startsWith: marker } } }),
    prisma.match.count({ where: { name: { startsWith: marker } } }),
    prisma.venue.count({ where: { name: { startsWith: marker } } }),
    prisma.user.count({ where: { email: { startsWith: marker } } }),
  ]);
  assert(
    remaining.reduce((sum, count) => sum + count, 0) === 0,
    'Smoke-test cleanup left marked rows behind.',
  );
}

try {
  await main();
} finally {
  await cleanup();
  await prisma.$disconnect();
}
