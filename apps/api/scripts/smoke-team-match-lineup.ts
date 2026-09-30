import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import type { MatchFormat } from '@footy-finder/shared';
import { getDefaultFormationKey, getPlayersPerTeam } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { MatchAvailabilityService } from '../src/modules/match-availability/match-availability.service.js';
import { MatchLineupService } from '../src/modules/match-lineup/match-lineup.service.js';
import { MatchesRepository } from '../src/modules/matches/matches.repository.js';
import { TeamsRepository } from '../src/modules/teams/teams.repository.js';
import { BookingsService } from '../src/modules/bookings/bookings.service.js';
import { managedVenueFixture } from './managed-venue-fixture.js';

const marker = `phase-1d-${randomUUID()}`;
const matches = new MatchesRepository();
const teams = new TeamsRepository();
const lineups = new MatchLineupService();
const availability = new MatchAvailabilityService();
const venueFixture = managedVenueFixture(marker);

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
      passwordHash: 'smoke-test-only',
      walletAccount: { create: { balanceCents: 100_000, currency: 'ZAR' } },
    },
  });
}

const fixtureInput = (suffix: string, format: MatchFormat, substituteCapacityPerTeam: number) => ({
  name: `${marker}-${suffix}`,
  format,
  substituteCapacityPerTeam,
  rollingSubstitutes: true,
  rules: ['GOALKEEPERS_SWAP_AFTER_EVERY_GOAL'] as Array<'GOALKEEPERS_SWAP_AFTER_EVERY_GOAL'>,
  startsAt: new Date(Date.now() + 86_400_000).toISOString(),
  formationKey: getDefaultFormationKey(format),
  venue: {
    name: `${marker}-${suffix}-venue`,
    addressLine1: '1 Lineup Road',
    city: 'Johannesburg',
    region: 'Gauteng',
    countryCode: 'ZA',
  },
});

async function balances(userIds: string[]) {
  const rows = await prisma.walletAccount.findMany({
    where: { userId: { in: userIds } },
    orderBy: { userId: 'asc' },
    select: { userId: true, balanceCents: true },
  });
  return rows.map(({ userId, balanceCents }) => `${userId}:${balanceCents}`).join('|');
}

async function main() {
  const users = await Promise.all(Array.from({ length: 18 }, (_, index) => createUser(index)));
  const [owner, captain, ...rest] = users;
  const outsider = rest.pop()!;
  const members = rest;
  const team = await teams.create(
    {
      name: `${marker}-team`,
      shortName: 'P1D',
      primaryFormat: 'FIVE_A_SIDE',
      formationKey: getDefaultFormationKey('FIVE_A_SIDE'),
    },
    owner.id,
  );
  await prisma.teamMembership.createMany({
    data: [
      { teamId: team.id, userId: captain.id, role: 'CAPTAIN' },
      ...members.map((member) => ({ teamId: team.id, userId: member.id, role: 'MEMBER' as const })),
    ],
  });
  const userIds = users.map(({ id }) => id);
  const balancesBefore = await balances(userIds);

  const fiveFormation = await prisma.teamFormation.findUniqueOrThrow({
    where: { teamId_format: { teamId: team.id, format: 'FIVE_A_SIDE' } },
    include: { slots: { orderBy: { slotIndex: 'asc' } } },
  });
  const teamMemberships = await prisma.teamMembership.findMany({ where: { teamId: team.id } });
  const membershipByUser = new Map(teamMemberships.map((item) => [item.userId, item.id]));
  await prisma.teamFormationSlot.update({
    where: { id: fiveFormation.slots[0]!.id },
    data: { membershipId: membershipByUser.get(owner.id), positionX: 44, positionY: 88 },
  });
  await prisma.teamFormationSlot.update({
    where: { id: fiveFormation.slots[1]!.id },
    data: { membershipId: membershipByUser.get(members[0]!.id) },
  });

  for (const [format, capacity] of [
    ['FIVE_A_SIDE', 0],
    ['SEVEN_A_SIDE', 5],
    ['ELEVEN_A_SIDE', 10],
  ] as const) {
    const fixture = await matches.createTeamFixture(
      team.id,
      fixtureInput(`capacity-${capacity}`, format, capacity),
      owner.id,
      60,
    );
    const lineup = await lineups.get(fixture.id, 'HOME', owner.id);
    assert(
      lineup.slots.length === getPlayersPerTeam(format),
      `${format} did not initialize its exact starter count.`,
    );
    assert(lineup.substituteCapacity === capacity, `${format} lost substitute capacity.`);
    const candidates = members.filter(
      (member) => !lineup.slots.some((slot) => slot.selection?.userId === member.id),
    );
    for (const candidate of candidates.slice(0, capacity))
      await lineups.selectSubstitute(fixture.id, 'HOME', candidate.id, owner.id);
    await expectCode(
      () => lineups.selectSubstitute(fixture.id, 'HOME', candidates[capacity]!.id, owner.id),
      'SUBSTITUTE_CAPACITY_REACHED',
    );
  }

  const fixture = await matches.createTeamFixture(
    team.id,
    fixtureInput('operations', 'FIVE_A_SIDE', 5),
    owner.id,
    60,
  );
  let lineup = await lineups.get(fixture.id, 'HOME', owner.id);
  assert(lineup.slots.length === 5, '5v5 lineup did not initialize five slots.');
  assert(lineup.selectionPool?.length === 2, 'Team default assignments were not copied.');
  assert(
    lineup.slots.every((slot) => slot.positionY >= 50),
    'HOME coordinates were not half-mapped.',
  );
  assert(lineup.slots[0]?.positionX === 44, 'Customized Team coordinate was not copied.');
  const memberView = await lineups.get(fixture.id, 'HOME', members[1]!.id);
  assert(!('selectionPool' in memberView), 'MEMBER received the management selection pool.');
  await expectCode(
    () => lineups.invite(fixture.id, 'HOME', members[2]!.id, members[1]!.id),
    'TEAM_FORBIDDEN',
  );
  await expectCode(() => lineups.get(fixture.id, 'AWAY', owner.id), 'TEAM_MATCH_SIDE_NOT_FOUND');

  await availability.request(fixture.id, 'HOME', owner.id);
  await lineups.invite(fixture.id, 'HOME', members[1]!.id, captain.id);
  const selectedAvailability = await availability.get(
    fixture.id,
    'HOME',
    { selected: true },
    captain.id,
  );
  assert(
    selectedAvailability.rows.some(
      (row) => row.userId === members[1]!.id && row.selectionStatus === 'INVITED',
    ),
    'INVITED did not participate in selected availability filtering.',
  );

  const defaultBefore = await prisma.teamFormation.findUniqueOrThrow({
    where: { id: fiveFormation.id },
    include: { slots: { orderBy: { slotIndex: 'asc' } } },
  });
  const defaultBeforeSignature = defaultBefore.slots
    .map((slot) => `${slot.slotIndex}:${slot.membershipId}:${slot.positionX}:${slot.positionY}`)
    .join('|');

  const [slotOne, slotTwo, slotThree, slotFour, slotFive] = lineup.slots;
  await lineups.assignStarter(
    fixture.id,
    'HOME',
    slotTwo!.id,
    {
      userId: owner.id,
      displacedPlayerAction: 'SWAP',
    },
    captain.id,
  );
  await lineups.assignStarter(
    fixture.id,
    'HOME',
    slotThree!.id,
    { userId: members[1]!.id },
    owner.id,
  );
  await expectCode(
    () =>
      lineups.assignStarter(
        fixture.id,
        'HOME',
        slotThree!.id,
        { userId: members[2]!.id },
        owner.id,
      ),
    'LINEUP_ACTION_REQUIRED',
  );
  await lineups.assignStarter(
    fixture.id,
    'HOME',
    slotThree!.id,
    { userId: members[2]!.id, displacedPlayerAction: 'BENCH' },
    owner.id,
  );
  lineup = await lineups.removeStarter(fixture.id, 'HOME', slotThree!.id, 'BENCH', captain.id);
  assert(lineup.substitutes.length === 2, 'Bench operations did not create substitutes.');
  await lineups.openSlot(fixture.id, 'HOME', slotThree!.id, {}, owner.id);

  const race = await Promise.allSettled([
    lineups.claim(fixture.id, 'HOME', slotThree!.id, members[3]!.id),
    lineups.claim(fixture.id, 'HOME', slotThree!.id, members[4]!.id),
  ]);
  assert(
    race.filter(({ status }) => status === 'fulfilled').length === 1,
    'Claim race had the wrong winner count.',
  );
  const rejected = race.find(({ status }) => status === 'rejected');
  assert(
    rejected?.status === 'rejected' && codeOf(rejected.reason) === 'POSITION_ALREADY_CLAIMED',
    'Claim race returned the wrong loser error.',
  );
  lineup = await lineups.get(fixture.id, 'HOME', owner.id);
  const claimantId = lineup.slots.find(({ id }) => id === slotThree!.id)!.selection!.userId;
  await lineups.assignStarter(
    fixture.id,
    'HOME',
    slotThree!.id,
    { userId: members[5]!.id, displacedPlayerAction: 'REMOVE' },
    captain.id,
  );
  await lineups.decline(fixture.id, 'HOME', members[5]!.id);
  lineup = await lineups.get(fixture.id, 'HOME', owner.id);
  assert(
    lineup.slots.find(({ id }) => id === slotThree!.id)?.isOpen,
    'Decline did not open the starter slot.',
  );
  assert(
    lineup.selectionPool?.find(({ userId }) => userId === claimantId)?.status === 'REMOVED',
    'Captain did not override the self-claim.',
  );

  await expectCode(() => lineups.finalize(fixture.id, 'HOME', owner.id), 'LINEUP_INCOMPLETE');
  await lineups.openSlot(fixture.id, 'HOME', slotFour!.id, {}, owner.id);
  await lineups.openSlot(fixture.id, 'HOME', slotFive!.id, {}, owner.id);
  const finalized = await lineups.finalize(fixture.id, 'HOME', captain.id);
  const finalizedAt = finalized.lineupFinalizedAt;
  assert(Boolean(finalizedAt), 'Complete/open lineup did not finalize.');
  const claimedFinalized = await lineups.claim(fixture.id, 'HOME', slotThree!.id, members[6]!.id);
  assert(
    claimedFinalized.lineupFinalizedAt === finalizedAt,
    'Pre-opened claim cleared finalization.',
  );
  const invitedAfterFinal = await lineups.invite(fixture.id, 'HOME', members[7]!.id, owner.id);
  assert(
    !invitedAfterFinal.lineupFinalizedAt,
    'Manager selection change did not clear finalization.',
  );
  await lineups.finalize(fixture.id, 'HOME', owner.id);
  const declined = await lineups.decline(fixture.id, 'HOME', members[6]!.id);
  assert(!declined.lineupFinalizedAt, 'Decline did not clear finalization.');
  assert(
    declined.slots.find(({ id }) => id === slotThree!.id)?.isOpen,
    'Decline did not reopen the claimed slot.',
  );

  await lineups.selectSubstitute(fixture.id, 'HOME', members[8]!.id, owner.id);
  await prisma.teamMembership.delete({
    where: { teamId_userId: { teamId: team.id, userId: members[8]!.id } },
  });
  await expectCode(
    () => lineups.finalize(fixture.id, 'HOME', owner.id),
    'LINEUP_MEMBER_NO_LONGER_ELIGIBLE',
  );
  await lineups.removeSubstitute(fixture.id, 'HOME', members[8]!.id, captain.id);
  const history = await lineups.get(fixture.id, 'HOME', captain.id);
  assert(
    history.selectionPool?.find(({ userId }) => userId === members[8]!.id)?.status === 'REMOVED',
    'Removed Team member selection history was lost.',
  );
  await expectCode(() => lineups.get(fixture.id, 'HOME', members[8]!.id), 'TEAM_FORBIDDEN');
  await lineups.finalize(fixture.id, 'HOME', owner.id);

  const defaultStillUnchanged = await prisma.teamFormation.findUniqueOrThrow({
    where: { id: fiveFormation.id },
    include: { slots: { orderBy: { slotIndex: 'asc' } } },
  });
  assert(
    defaultStillUnchanged.slots
      .map((slot) => `${slot.slotIndex}:${slot.membershipId}:${slot.positionX}:${slot.positionY}`)
      .join('|') === defaultBeforeSignature,
    'Match-Day edits mutated the Team default.',
  );
  const matchBeforeSave = (await lineups.get(fixture.id, 'HOME', owner.id)).slots
    .map((slot) => `${slot.id}:${slot.selection?.userId ?? 'open'}:${slot.isOpen}`)
    .join('|');
  const savedDefault = await lineups.saveAsTeamDefault(fixture.id, 'HOME', captain.id);
  assert(
    savedDefault.slots[0]?.member?.userId === members[0]!.id,
    'Swapped starter was not saved as default.',
  );
  assert(
    savedDefault.slots[1]?.member?.userId === owner.id,
    'Swapped owner was not saved as default.',
  );
  assert(
    savedDefault.slots.slice(2).every((slot) => !slot.member),
    'Open slots became assigned defaults.',
  );
  const matchAfterSave = (await lineups.get(fixture.id, 'HOME', owner.id)).slots
    .map((slot) => `${slot.id}:${slot.selection?.userId ?? 'open'}:${slot.isOpen}`)
    .join('|');
  assert(matchAfterSave === matchBeforeSave, 'Saving the Team default mutated the Match lineup.');

  const legacy = await matches.createTeamFixture(
    team.id,
    fixtureInput('legacy-backfill', 'SEVEN_A_SIDE', 5),
    owner.id,
    60,
  );
  const legacySideId = legacy.teamSides[0]!.id;
  await prisma.teamMatchLineupSlot.deleteMany({ where: { matchTeamId: legacySideId } });
  await prisma.teamMatchSelection.deleteMany({ where: { matchTeamId: legacySideId } });
  await prisma.$executeRaw`
    INSERT INTO "TeamMatchLineupSlot" (
      "id", "matchTeamId", "slotIndex", "positionX", "positionY", "isOpen", "createdAt", "updatedAt"
    )
    SELECT gen_random_uuid(), mt."id", fs."slotIndex", fs."positionX", fs."positionY", false,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM "MatchTeam" mt
    INNER JOIN "FormationSlot" fs
      ON fs."matchId" = mt."matchId" AND fs."team" = mt."side"
    WHERE mt."id" = ${legacySideId}::uuid
  `;
  assert(
    (await prisma.teamMatchLineupSlot.count({ where: { matchTeamId: legacySideId } })) === 7,
    'Existing-fixture backfill did not copy starter slots.',
  );
  assert(
    (await prisma.teamMatchSelection.count({ where: { matchTeamId: legacySideId } })) === 0,
    'Existing-fixture backfill invented selections.',
  );

  // A Quick Match is created on a managed slot with the fixed R80 fee (Gate 3 / DEC-018).
  await venueFixture.create();
  const quick = await new BookingsService().createQuickMatch(
    {
      managedFieldId: venueFixture.fieldId,
      name: `${marker}-quick`,
      format: 'FIVE_A_SIDE',
      substituteCapacityPerTeam: 5,
      rollingSubstitutes: true,
      rules: [],
      visibility: 'PUBLIC',
      startsAt: venueFixture.nextKickoff().toISOString(),
    },
    outsider.id,
  );
  await expectCode(() => lineups.get(quick.id, 'HOME', outsider.id), 'TEAM_MATCH_SIDE_NOT_FOUND');
  assert((await balances(userIds)) === balancesBefore, 'Lineup operations mutated a wallet.');
  const markedMatchIds = (
    await prisma.match.findMany({
      where: { name: { startsWith: marker } },
      select: { id: true },
    })
  ).map(({ id }) => id);
  assert(
    (await prisma.matchParticipant.count({ where: { matchId: { in: markedMatchIds } } })) === 0,
    'Match-Day selections became MatchParticipant rows.',
  );
  assert(slotOne, 'Lineup lost its first slot during the smoke test.');
  console.log('Phase 1D PostgreSQL smoke test passed.');
}

async function cleanup() {
  const markedMatches = await prisma.match.findMany({
    where: { name: { startsWith: marker } },
    select: { id: true, venueId: true },
  });
  const matchIds = markedMatches.map(({ id }) => id);
  await venueFixture.cleanupMatches(matchIds);
  if (matchIds.length) await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  const teamIds = (
    await prisma.team.findMany({ where: { name: { startsWith: marker } }, select: { id: true } })
  ).map(({ id }) => id);
  if (teamIds.length) await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
  if (markedMatches.length)
    await prisma.venue.deleteMany({
      where: { id: { in: markedMatches.map(({ venueId }) => venueId) } },
    });
  await venueFixture.cleanupVenue();
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
