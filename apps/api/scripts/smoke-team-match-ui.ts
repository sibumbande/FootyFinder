import { randomUUID } from 'node:crypto';
import { getDefaultFormationKey } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { domainEvents } from '../src/events/domain-events.js';
import { MatchLineupService } from '../src/modules/match-lineup/match-lineup.service.js';
import { MatchesRepository } from '../src/modules/matches/matches.repository.js';
import { TeamsRepository } from '../src/modules/teams/teams.repository.js';

const marker = `phase-1e-${randomUUID()}`;
const matches = new MatchesRepository();
const teams = new TeamsRepository();
const lineups = new MatchLineupService();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const codeOf = (error: unknown) =>
  error instanceof Error && 'code' in error ? String(error.code) : undefined;
async function expectCode(work: () => Promise<unknown>, code: string) {
  try {
    await work();
  } catch (error) {
    if (codeOf(error) === code) return;
    throw error;
  }
  throw new Error(`Expected ${code}.`);
}
async function createUser(index: number) {
  return prisma.user.create({
    data: {
      email: `${marker}-${index}@smoke.invalid`,
      username: `${marker.slice(0, 18)}-${index}`,
      passwordHash: 'smoke-only',
      walletAccount: { create: { balanceCents: 50_000, currency: 'ZAR' } },
    },
  });
}

async function main() {
  const [owner, captain, member] = await Promise.all([createUser(1), createUser(2), createUser(3)]);
  const team = await teams.create(
    {
      name: `${marker}-team`,
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
  const fixture = await matches.createTeamFixture(
    team.id,
    {
      name: `${marker}-fixture`,
      format: 'FIVE_A_SIDE',
      substituteCapacityPerTeam: 5,
      rollingSubstitutes: true,
      rules: ['GOALKEEPERS_SWAP_AFTER_EVERY_GOAL'],
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      formationKey: getDefaultFormationKey('FIVE_A_SIDE'),
      venue: {
        name: `${marker}-venue`,
        addressLine1: '1 Match-Day Road',
        city: 'Johannesburg',
        region: 'Gauteng',
        countryCode: 'ZA',
      },
    },
    owner.id,
    90,
  );
  const side = fixture.teamSides[0]!;
  const events: Array<{ matchId: string; side: string; reason: string }> = [];
  const listener = (payload: { matchId: string; side: string; reason: string }) =>
    events.push(payload);
  domainEvents.on('match-lineup:changed', listener);
  try {
    let lineup = await lineups.get(fixture.id, 'HOME', owner.id);
    const first = lineup.slots[0]!;
    await lineups.invite(fixture.id, 'HOME', member.id, owner.id);
    assert(
      (await prisma.notification.count({
        where: { userId: member.id, type: 'TEAM_MATCH_SELECTION_UPDATED' },
      })) === 1,
      'Selection notification was not persisted exactly once.',
    );
    await lineups.invite(fixture.id, 'HOME', member.id, owner.id);
    assert(
      (await prisma.notification.count({
        where: { userId: member.id, type: 'TEAM_MATCH_SELECTION_UPDATED' },
      })) === 1,
      'Idempotent invitation duplicated its notification.',
    );
    const eventCount = events.length;
    await expectCode(
      () =>
        lineups.moveSlot(fixture.id, 'HOME', first.id, { positionX: 45, positionY: 40 }, owner.id),
      'POSITION_OUTSIDE_TEAM_HALF',
    );
    assert(events.length === eventCount, 'Failed movement emitted a room event.');
    await lineups.moveSlot(
      fixture.id,
      'HOME',
      first.id,
      { positionX: 45, positionY: 70 },
      owner.id,
    );
    lineup = await lineups.get(fixture.id, 'HOME', owner.id);
    assert(lineup.slots[0]?.positionY === 70, 'Valid Match-Day movement did not persist.');

    await lineups.openSlot(fixture.id, 'HOME', first.id, {}, owner.id);
    assert(
      (await prisma.notification.count({
        where: { userId: member.id, type: 'TEAM_MATCH_POSITION_OPENED' },
      })) === 1,
      'Open-position notification was not persisted.',
    );
    await lineups.claim(fixture.id, 'HOME', first.id, member.id);
    assert(
      (await prisma.notification.count({
        where: { userId: owner.id, type: 'TEAM_MATCH_POSITION_CLAIMED' },
      })) === 1,
      'Claim did not notify the Team owner.',
    );
    assert(
      (await prisma.notification.count({
        where: { userId: captain.id, type: 'TEAM_MATCH_POSITION_CLAIMED' },
      })) === 1,
      'Claim did not notify the captain.',
    );
    lineup = await lineups.get(fixture.id, 'HOME', owner.id);
    for (const slot of lineup.slots.slice(1))
      await lineups.openSlot(fixture.id, 'HOME', slot.id, {}, owner.id);
    await lineups.finalize(fixture.id, 'HOME', owner.id);
    const finalizedNotifications = await prisma.notification.count({
      where: { userId: member.id, type: 'TEAM_MATCH_LINEUP_FINALIZED' },
    });
    assert(finalizedNotifications === 1, 'Finalization did not notify the active player.');
    await lineups.finalize(fixture.id, 'HOME', owner.id);
    assert(
      (await prisma.notification.count({
        where: { userId: member.id, type: 'TEAM_MATCH_LINEUP_FINALIZED' },
      })) === finalizedNotifications,
      'Idempotent finalization duplicated notifications.',
    );
    assert(
      events.some(({ reason }) => reason === 'MOVEMENT'),
      'Movement event was not emitted.',
    );
    assert(
      events.some(({ reason }) => reason === 'POSITION_OPENED'),
      'Open event was not emitted.',
    );
    assert(
      events.some(({ reason }) => reason === 'POSITION_CLAIMED'),
      'Claim event was not emitted.',
    );
    assert(
      events.some(({ reason }) => reason === 'FINALIZED'),
      'Finalization event was not emitted.',
    );
    assert(
      (await prisma.matchParticipant.count({ where: { matchId: fixture.id } })) === 0,
      'Match-Day UI operations created historical participants.',
    );
    const balances = await prisma.walletAccount.findMany({
      where: { userId: { in: [owner.id, captain.id, member.id] } },
      select: { balanceCents: true },
    });
    assert(
      balances.every(({ balanceCents }) => balanceCents === 50_000),
      'Match-Day UI operations mutated wallets.',
    );
  } finally {
    domainEvents.off('match-lineup:changed', listener);
  }
  console.log('Phase 1E PostgreSQL smoke test passed.');
}

async function cleanup() {
  const markedMatches = await prisma.match.findMany({
    where: { name: { startsWith: marker } },
    select: { id: true, venueId: true },
  });
  if (markedMatches.length) {
    await prisma.match.deleteMany({ where: { id: { in: markedMatches.map(({ id }) => id) } } });
    await prisma.venue.deleteMany({
      where: { id: { in: markedMatches.map(({ venueId }) => venueId) } },
    });
  }
  await prisma.team.deleteMany({ where: { name: { startsWith: marker } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: marker } } });
  const remaining = await Promise.all([
    prisma.match.count({ where: { name: { startsWith: marker } } }),
    prisma.team.count({ where: { name: { startsWith: marker } } }),
    prisma.venue.count({ where: { name: { startsWith: marker } } }),
    prisma.user.count({ where: { email: { startsWith: marker } } }),
  ]);
  assert(
    remaining.every((count) => count === 0),
    'Phase 1E cleanup left marked rows behind.',
  );
}

try {
  await main();
} finally {
  await cleanup();
  await prisma.$disconnect();
}
