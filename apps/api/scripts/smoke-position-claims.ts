import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { createDefaultFormation } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import {
  MatchClosedError,
  MatchesRepository,
  NotMatchParticipantError,
  PositionAlreadyClaimedError,
  PositionWrongSideError,
} from '../src/modules/matches/matches.repository.js';

// Gate 5 / TKT-501: proves first-committed-claim-wins and the claim eligibility matrix against
// real PostgreSQL. Runs only against an approved disposable database (see docs/TEST_DATABASE.md).
const marker = `gate-5-claims-${randomUUID()}`;
const repository = new MatchesRepository();
const CLAIM_RACE_ROUNDS = 5;
const CLAIMANTS_PER_ROUND = 4;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function createUser(index: number) {
  return prisma.user.create({
    data: {
      email: `${marker}-${index}@smoke.invalid`,
      username: `${marker.slice(0, 20)}-${index}`,
      passwordHash: 'smoke-test-only',
    },
  });
}

async function createMatch(hostId: string, suffix: string, startsAt: Date) {
  const venue = await prisma.venue.create({
    data: {
      name: `${marker}-${suffix}`,
      addressLine1: '1 Smoke Test Road',
      city: 'Cape Town',
      region: 'Western Cape',
      countryCode: 'ZA',
    },
  });
  return prisma.match.create({
    data: {
      name: `${marker}-${suffix}`,
      createdById: hostId,
      venueId: venue.id,
      format: 'FIVE_A_SIDE',
      visibility: 'PRIVATE',
      startsAt,
      durationMinutes: 60,
      feeCents: 0,
      formationSlots: { create: createDefaultFormation('FIVE_A_SIDE') },
    },
    include: { formationSlots: { orderBy: [{ team: 'asc' }, { slotIndex: 'asc' }] } },
  });
}

async function join(matchId: string, userId: string, team: 'HOME' | 'AWAY') {
  return prisma.matchParticipant.create({ data: { matchId, userId, team } });
}

async function rejectsWith(promise: Promise<unknown>, errorType: new () => Error) {
  try {
    await promise;
    return false;
  } catch (error) {
    return error instanceof errorType;
  }
}

async function main() {
  const users = await Promise.all(
    Array.from({ length: CLAIMANTS_PER_ROUND + 3 }, (_, index) => createUser(index)),
  );
  const [host, ...players] = users;
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1_000);

  // 1. Concurrency: several same-side participants race for one open slot, repeatedly.
  for (let round = 0; round < CLAIM_RACE_ROUNDS; round += 1) {
    const match = await createMatch(host.id, `race-${round}`, tomorrow);
    const target = match.formationSlots.find((slot) => slot.team === 'HOME');
    assert(target, 'Fixture has no HOME slot.');
    const claimants = players.slice(0, CLAIMANTS_PER_ROUND);
    const participants = await Promise.all(
      claimants.map((user) => join(match.id, user.id, 'HOME')),
    );
    const outcomes = await Promise.allSettled(
      claimants.map((user) => repository.claimPosition(match.id, target.id, user.id)),
    );
    const winners = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const conflicts = outcomes.filter(
      (outcome) =>
        outcome.status === 'rejected' && outcome.reason instanceof PositionAlreadyClaimedError,
    );
    const unexpected = outcomes.filter(
      (outcome) =>
        outcome.status === 'rejected' && !(outcome.reason instanceof PositionAlreadyClaimedError),
    );
    assert(
      unexpected.length === 0,
      `Round ${round}: unexpected claim failure ${String(
        (unexpected[0] as PromiseRejectedResult | undefined)?.reason,
      )}`,
    );
    assert(winners.length === 1, `Round ${round}: expected exactly one winner, got ${winners.length}.`);
    assert(
      conflicts.length === CLAIMANTS_PER_ROUND - 1,
      `Round ${round}: every loser must receive POSITION_ALREADY_CLAIMED.`,
    );
    const owner = await prisma.formationSlot.findUniqueOrThrow({ where: { id: target.id } });
    assert(
      participants.some(({ id }) => id === owner.participantId),
      `Round ${round}: the slot owner is not one of the claimants.`,
    );
    const persisted = await prisma.match.findUniqueOrThrow({ where: { id: match.id } });
    const events = await prisma.matchFormationEvent.findMany({ where: { matchId: match.id } });
    assert(persisted.formationVersion === 1, `Round ${round}: version must advance exactly once.`);
    assert(
      events.length === 1 && events[0].action === 'SELF_CLAIM',
      `Round ${round}: exactly one SELF_CLAIM audit row is required.`,
    );
  }

  // 2. Eligibility matrix and self-move on one Match.
  const match = await createMatch(host.id, 'matrix', tomorrow);
  const homeSlots = match.formationSlots.filter((slot) => slot.team === 'HOME');
  const awaySlot = match.formationSlots.find((slot) => slot.team === 'AWAY');
  assert(homeSlots.length >= 2 && awaySlot, 'Fixture formation is incomplete.');
  const homePlayer = players[0];
  const outsider = players[1];
  await join(match.id, homePlayer.id, 'HOME');

  assert(
    await rejectsWith(
      repository.claimPosition(match.id, homeSlots[0].id, outsider.id),
      NotMatchParticipantError,
    ),
    'A non-participant claimed a position.',
  );
  assert(
    await rejectsWith(
      repository.claimPosition(match.id, awaySlot.id, homePlayer.id),
      PositionWrongSideError,
    ),
    'A player claimed a position on the opposite side.',
  );
  await repository.claimPosition(match.id, homeSlots[0].id, homePlayer.id);
  const replay = await repository.claimPosition(match.id, homeSlots[0].id, homePlayer.id);
  assert(replay.replayed, 'Repeating a held claim must be an idempotent replay.');
  await repository.claimPosition(match.id, homeSlots[1].id, homePlayer.id);
  const [first, second] = await Promise.all(
    [homeSlots[0].id, homeSlots[1].id].map((id) =>
      prisma.formationSlot.findUniqueOrThrow({ where: { id } }),
    ),
  );
  assert(
    first.participantId === null && second.participantId !== null,
    'A self-move must vacate the previous slot and occupy the new one atomically.',
  );
  const moveEvents = await prisma.matchFormationEvent.findMany({
    where: { matchId: match.id },
    orderBy: { formationVersion: 'asc' },
  });
  assert(
    moveEvents.map(({ action }) => action).join(',') === 'SELF_CLAIM,SELF_MOVE',
    'Claim and self-move must each append one audit row.',
  );

  // 3. Organiser removal is audited and notifies the affected player.
  const removal = await repository.updateFormation(
    match.id,
    homeSlots[1].id,
    { participantId: null },
    host.id,
  );
  assert(removal.changed, 'Organiser removal did not report a change.');
  assert(
    removal.notifications.some(
      (notification) =>
        notification.userId === homePlayer.id && notification.type === 'MATCH_POSITION_CHANGED',
    ),
    'The removed player was not notified.',
  );
  const removalEvent = await prisma.matchFormationEvent.findFirst({
    where: { matchId: match.id, action: 'ORGANISER_REMOVE' },
  });
  assert(removalEvent?.actorUserId === host.id, 'Organiser removal was not audited.');

  // 4. The audit log is append-only.
  let updateRejected = false;
  try {
    await prisma.matchFormationEvent.update({
      where: { id: removalEvent.id },
      data: { action: 'SELF_CLAIM' },
    });
  } catch {
    updateRejected = true;
  }
  assert(updateRejected, 'MatchFormationEvent accepted an UPDATE.');

  // 5. Claims close at kickoff.
  const started = await createMatch(host.id, 'kicked-off', new Date(Date.now() - 60_000));
  await join(started.id, homePlayer.id, 'HOME');
  const startedSlot = started.formationSlots.find((slot) => slot.team === 'HOME');
  assert(startedSlot, 'Kicked-off fixture has no HOME slot.');
  assert(
    await rejectsWith(
      repository.claimPosition(started.id, startedSlot.id, homePlayer.id),
      MatchClosedError,
    ),
    'A claim was accepted after kickoff.',
  );

  console.log(
    `Gate 5 position-claim PostgreSQL smoke test passed (${CLAIM_RACE_ROUNDS} races x ${CLAIMANTS_PER_ROUND} claimants).`,
  );
}

async function cleanup() {
  const matches = await prisma.match.findMany({
    where: { name: { startsWith: marker } },
    select: { id: true, venueId: true },
  });
  const matchIds = matches.map(({ id }) => id);
  const venueIds = matches.map(({ venueId }) => venueId);
  if (matchIds.length) {
    await prisma.notification.deleteMany({
      where: { dedupeKey: { startsWith: 'match-formation-event:' }, user: { email: { startsWith: marker } } },
    });
    await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  }
  if (venueIds.length) await prisma.venue.deleteMany({ where: { id: { in: venueIds } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: marker } } });
  const [remainingMatches, remainingUsers] = await Promise.all([
    prisma.match.count({ where: { name: { startsWith: marker } } }),
    prisma.user.count({ where: { email: { startsWith: marker } } }),
  ]);
  assert(remainingMatches + remainingUsers === 0, 'Smoke-test cleanup left marked rows behind.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
    await prisma.$disconnect();
  });
