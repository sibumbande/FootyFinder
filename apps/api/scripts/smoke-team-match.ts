import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { getDefaultFormationKey } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { MatchesService } from '../src/modules/matches/matches.service.js';
import {
  MatchesRepository,
  TeamFixtureForbiddenError,
  TeamMatchPlanningError,
} from '../src/modules/matches/matches.repository.js';
import { TeamsRepository } from '../src/modules/teams/teams.repository.js';
import { deleteTeamWalletFixtures } from './team-wallet-fixtures.js';

const marker = `phase-1b-${randomUUID()}`;
const matches = new MatchesRepository();
const teams = new TeamsRepository();

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

const fixtureInput = (suffix: string, startsAt = new Date(Date.now() + 86_400_000)) => ({
  name: `${marker}-${suffix}`,
  format: 'FIVE_A_SIDE' as const,
  substituteCapacityPerTeam: 5,
  rollingSubstitutes: true,
  rules: ['GOALKEEPERS_SWAP_AFTER_EVERY_GOAL'] as Array<'GOALKEEPERS_SWAP_AFTER_EVERY_GOAL'>,
  startsAt: startsAt.toISOString(),
  formationKey: getDefaultFormationKey('FIVE_A_SIDE'),
  venue: {
    name: `${marker}-${suffix}-venue`,
    addressLine1: '1 Team Fixture Road',
    city: 'Johannesburg',
    region: 'Gauteng',
    countryCode: 'ZA',
  },
});

async function balances(userIds: string[]) {
  const wallets = await prisma.walletAccount.findMany({
    where: { userId: { in: userIds } },
    orderBy: { userId: 'asc' },
    select: { userId: true, balanceCents: true },
  });
  return wallets.map(({ userId, balanceCents }) => `${userId}:${balanceCents}`).join('|');
}

async function main() {
  const [owner, captain, member, outsider] = await Promise.all(
    Array.from({ length: 4 }, (_, index) => createUser(index)),
  );
  const team = await teams.create(
    {
      name: `${marker}-team`,
      shortName: 'P1B',
      primaryFormat: 'FIVE_A_SIDE',
      formationKey: getDefaultFormationKey('FIVE_A_SIDE'),
      primaryColor: '#14213D',
      secondaryColor: '#6CB4EE',
    },
    owner.id,
  );
  await prisma.teamMembership.createMany({
    data: [
      { teamId: team.id, userId: captain.id, role: 'CAPTAIN' },
      { teamId: team.id, userId: member.id, role: 'MEMBER' },
    ],
  });

  const userIds = [owner.id, captain.id, member.id, outsider.id];
  const balancesBefore = await balances(userIds);
  const ownerFixture = await matches.createTeamFixture(
    team.id,
    fixtureInput('owner-fixture'),
    owner.id,
    60,
  );
  const captainFixture = await matches.createTeamFixture(
    team.id,
    fixtureInput('captain-fixture', new Date(Date.now() - 86_400_000)),
    captain.id,
    60,
  );

  for (const blockedUserId of [member.id, outsider.id]) {
    let forbidden = false;
    try {
      await matches.createTeamFixture(
        team.id,
        fixtureInput(`blocked-${blockedUserId}`),
        blockedUserId,
        60,
      );
    } catch (error) {
      forbidden = error instanceof TeamFixtureForbiddenError;
    }
    assert(forbidden, 'A MEMBER or outsider created a Team fixture.');
  }

  assert(ownerFixture.mode === 'TEAM_MATCH', 'Fixture mode is not TEAM_MATCH.');
  assert(ownerFixture.status === 'DRAFT', 'Fixture status is not DRAFT.');
  assert(ownerFixture.visibility === 'PRIVATE', 'Fixture is not private.');
  assert(ownerFixture.feeCents === 0, 'Fixture is not free.');
  assert(ownerFixture.inviteToken === null, 'Private Team fixture received a Quick Game invite.');
  assert(ownerFixture.teamSides.length === 1, 'Fixture did not create exactly one Team side.');
  assert(ownerFixture.teamSides[0]?.side === 'HOME', 'Initial Team side is not HOME.');
  assert(
    ownerFixture.teamSides[0]?.teamNameSnapshot === team.name,
    'Team name snapshot was not persisted.',
  );
  assert(
    ownerFixture.teamSides[0]?.primaryColorSnapshot === '#14213D',
    'Team color snapshot was not persisted.',
  );
  assert((await balances(userIds)) === balancesBefore, 'Fixture creation mutated a wallet.');

  const listed = await matches.listForTeam(team.id);
  assert(listed.length === 2, 'Team fixture listing did not return both fixtures.');

  const matchService = new MatchesService(matches);
  const memberView = await matchService.get(ownerFixture.id, member.id);
  assert(memberView.viewerCanChat, 'Current Team member did not receive room access.');
  assert(!memberView.viewerCanManage, 'MEMBER received fixture management access.');
  const captainView = await matchService.get(ownerFixture.id, captain.id);
  assert(captainView.viewerCanManage, 'CAPTAIN did not receive fixture management access.');
  let privateFromOutsider = false;
  try {
    await matchService.get(ownerFixture.id, outsider.id);
  } catch (error) {
    privateFromOutsider =
      error instanceof Error && 'code' in error && error.code === 'PRIVATE_MATCH';
  }
  assert(privateFromOutsider, 'Outsider accessed a private Team fixture.');

  let quickJoinBlocked = false;
  try {
    await matches.join(ownerFixture.id, member.id, { team: 'HOME' }, randomUUID());
  } catch (error) {
    quickJoinBlocked = error instanceof TeamMatchPlanningError;
  }
  assert(quickJoinBlocked, 'Team fixture entered the Quick Game payment/join path.');
  assert((await balances(userIds)) === balancesBefore, 'Blocked join mutated a wallet.');

  await prisma.match.update({ where: { id: ownerFixture.id }, data: { status: 'COMPLETED' } });
  const closed = await teams.close(team.id, owner.id);
  assert(closed.outcome === 'CLOSED', 'Team closure did not archive the team.');
  assert((await prisma.team.findUniqueOrThrow({ where: { id: team.id } })).archivedAt, 'Closed Team was not archived.');
  const [historical, unfinished] = await Promise.all([
    prisma.match.findUniqueOrThrow({
      where: { id: ownerFixture.id },
      include: { teamSides: true },
    }),
    prisma.match.findUniqueOrThrow({
      where: { id: captainFixture.id },
      include: { teamSides: true },
    }),
  ]);
  assert(historical.status === 'COMPLETED', 'Team closure changed completed Match history.');
  assert(unfinished.status === 'CANCELLED', 'Team closure did not cancel an unfinished private fixture.');
  assert(historical.teamSides[0]?.teamId === team.id, 'Closed Team lost its match history link.');
  assert(
    historical.teamSides[0]?.teamNameSnapshot === team.name,
    'Closed Team lost its historical snapshot.',
  );

  console.log('Phase 1B PostgreSQL smoke test passed.');
}

async function cleanup() {
  const markedTeams = await prisma.team.findMany({
    where: { name: { startsWith: marker } },
    select: { id: true },
  });
  await deleteTeamWalletFixtures(markedTeams.map(({ id }) => id));
  if (markedTeams.length)
    await prisma.team.deleteMany({ where: { id: { in: markedTeams.map(({ id }) => id) } } });
  const markedMatches = await prisma.match.findMany({
    where: { name: { startsWith: marker } },
    select: { id: true, venueId: true },
  });
  if (markedMatches.length)
    await prisma.match.deleteMany({ where: { id: { in: markedMatches.map(({ id }) => id) } } });
  if (markedMatches.length)
    await prisma.venue.deleteMany({
      where: { id: { in: markedMatches.map(({ venueId }) => venueId) } },
    });
  await prisma.user.deleteMany({ where: { email: { startsWith: marker } } });
  const [remainingTeams, remainingMatches, remainingVenues, remainingUsers] = await Promise.all([
    prisma.team.count({ where: { name: { startsWith: marker } } }),
    prisma.match.count({ where: { name: { startsWith: marker } } }),
    prisma.venue.count({ where: { name: { startsWith: marker } } }),
    prisma.user.count({ where: { email: { startsWith: marker } } }),
  ]);
  assert(
    remainingTeams + remainingMatches + remainingVenues + remainingUsers === 0,
    'Smoke-test cleanup left marked rows behind.',
  );
}

try {
  await main();
} finally {
  await cleanup();
  await prisma.$disconnect();
}
