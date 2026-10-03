import './assert-disposable-test-database.js';
import { removeTicketJobsSince } from './support/ticket-job-cleanup.js';
const smokeStartedAt = new Date();
import { randomUUID } from 'node:crypto';
import { getDefaultFormationKey } from '@footy-finder/shared';
import type { Notification } from '../src/generated/prisma/client.js';
import { prisma } from '../src/database/prisma.js';
import { serializableTransaction } from '../src/database/transaction.js';
import { MessagingRepository } from '../src/modules/messaging/messaging.repository.js';
import { transitionMatchToStarted } from '../src/modules/matches/match-lifecycle.scheduler.js';
import { MatchesRepository } from '../src/modules/matches/matches.repository.js';
import {
  notificationDedupeKey,
  persistNotifications,
} from '../src/modules/notifications/notification-writer.js';
import type { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import { TeamsRepository } from '../src/modules/teams/teams.repository.js';
import { BookingsService } from '../src/modules/bookings/bookings.service.js';
import { managedVenueFixture } from './managed-venue-fixture.js';
import { buyTicket, leaveTicket, removeTicketRows } from './support/ticket-fixtures.js';

const marker = `atomic-notifications-${randomUUID()}`;
const markerPrefix = marker;
// Since Gate 3 a Quick Match is created on a managed slot with the fixed R80 fee (DEC-018).
const venueFixture = managedVenueFixture(marker);
const bookings = new BookingsService();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function createUser(index: number) {
  const user = await prisma.user.create({
    data: {
      email: `${marker}-${index}@smoke.invalid`,
      username: `${marker.slice(0, 22)}-${index}`,
      passwordHash: 'smoke-test-only',
      emailVerifiedAt: new Date(),
      onboardingCompletedAt: new Date(),
      profile: { create: { displayName: `Atomic Player ${index}`, onboardingStatus: 'COMPLETE', gender: 'MALE' } },
    },
  });
  return user;
}

async function main() {
  const [owner, member, third] = await Promise.all([createUser(0), createUser(1), createUser(2)]);

  const concurrentKey = notificationDedupeKey(marker, 'concurrent', owner.id);
  const concurrentWrites = await Promise.all(
    Array.from({ length: 2 }, () =>
      serializableTransaction((tx) =>
        persistNotifications(tx, [
          {
            userId: owner.id,
            type: 'INFO',
            title: 'Concurrent notification',
            message: 'Only one row should survive.',
            dedupeKey: concurrentKey,
          },
        ]),
      ),
    ),
  );
  assert(
    concurrentWrites.flat().length === 1,
    'Concurrent deduplication did not return exactly one inserted notification.',
  );
  assert(
    (await prisma.notification.count({ where: { dedupeKey: concurrentKey } })) === 1,
    'Concurrent deduplication did not persist exactly one notification.',
  );

  const originalUsername = owner.username;
  let rollbackFailed = false;
  try {
    await serializableTransaction(async (tx) => {
      await tx.user.update({ where: { id: owner.id }, data: { username: `${marker}-rollback` } });
      await persistNotifications(tx, [
        {
          userId: randomUUID(),
          type: 'INFO',
          title: 'Must fail',
          message: 'The foreign-key failure must roll back the user update.',
          dedupeKey: notificationDedupeKey(marker, 'rollback'),
        },
      ]);
    });
  } catch {
    rollbackFailed = true;
  }
  assert(rollbackFailed, 'The rollback fixture did not fail as expected.');
  assert(
    (await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).username ===
      originalUsername,
    'A failed notification write did not roll back domain state.',
  );

  const matches = new MatchesRepository();
  await venueFixture.create();
  const cancellationKickoff = venueFixture.nextKickoff();
  const cancellationMatch = await bookings.createQuickMatch(
    {
      managedFieldId: venueFixture.fieldId,
      name: `${marker}-cancellation`,
      format: 'FIVE_A_SIDE',
      substituteCapacityPerTeam: 5,
      rollingSubstitutes: false,
      rules: [],
      visibility: 'PRIVATE',
      startsAt: cancellationKickoff.toISOString(),
    },
    owner.id,
  );
  // DEC-021: buying a ticket with a replayed idempotency key places the player once and notifies nobody again.
  const joinKey = `${marker}-join`;
  const noticesFor = () => prisma.notification.count({ where: { targetPath: { contains: cancellationMatch.id } } });
  const firstJoin = await buyTicket(cancellationMatch.id, member.id, 'AWAY', joinKey);
  const afterJoin = await noticesFor();
  const replayedJoin = await buyTicket(cancellationMatch.id, member.id, 'AWAY', joinKey);
  assert(replayedJoin.result.checkoutId === firstJoin.result.checkoutId, 'A replayed purchase started a second checkout.');
  assert((await noticesFor()) === afterJoin, 'A replayed purchase created notifications.');
  // Leaving more than 24 hours out with a refund is recorded once; leaving again is refused and changes nothing.
  assert((await leaveTicket(cancellationMatch.id, member.id, 'REFUND')).outcome === 'REFUNDED', 'Leaving did not refund.');
  const afterLeave = await noticesFor();
  const leftAgain = await leaveTicket(cancellationMatch.id, member.id, 'REFUND').then(() => 'OK', (error: { code?: string }) => error.code);
  assert(leftAgain === 'NOT_IN_MATCH' && (await noticesFor()) === afterLeave, 'Leaving twice was not refused cleanly.');
  assert((await prisma.providerRefund.count({ where: { ticketId: { in: firstJoin.result.ticketIds } } })) === 1, 'The leave refund was not recorded exactly once.');
  await buyTicket(cancellationMatch.id, third.id, 'AWAY', `${marker}-third`);
  const cancelled = await matches.cancelMatch(cancellationMatch.id);
  const cancelledReplay = await matches.cancelMatch(cancellationMatch.id);
  // DEC-018 / TKT-316 / DEC-021: a host cancellation notifies every joined player, every payer still holding a ticket
  // and the host, once each (here the third player and the host).
  assert(
    cancelled.notifications.length === 2 &&
      new Set(cancelled.notifications.map(({ userId }) => userId)).size === 2 &&
      cancelled.notifications.every(({ userId }) => [third.id, owner.id].includes(userId)),
    'Match cancellation notifications were not atomic, one per recipient.',
  );
  assert(
    cancelledReplay.notifications.length === 0,
    'Match cancellation replay created a duplicate notification.',
  );

  const resultMatch = await bookings.createQuickMatch(
    {
      managedFieldId: venueFixture.fieldId,
      name: `${marker}-result`,
      format: 'FIVE_A_SIDE',
      substituteCapacityPerTeam: 5,
      rollingSubstitutes: false,
      rules: [],
      visibility: 'PRIVATE',
      startsAt: venueFixture.nextKickoff().toISOString(),
    },
    owner.id,
  );
  const resultParticipant = await buyTicket(resultMatch.id, member.id, 'HOME', `${marker}-result-join`,);
  await prisma.match.update({
    where: { id: resultMatch.id },
    data: {
      status: 'AWAITING_RESULT',
      startsAt: new Date(Date.now() - 60 * 60 * 1_000),
      goNoGoAt: new Date(Date.now() - 90 * 60 * 1_000),
    },
  });
  const submitted = await matches.submitResult(resultMatch.id, owner.id, {
    homeScore: 1,
    awayScore: 0,
    scorers: [{ participantId: resultParticipant.participant.id, goals: 1 }],
  });
  assert(
    submitted.notifications.length === 2,
    'Result notifications were not persisted atomically.',
  );

  const messages = new MessagingRepository();
  const conversation = await messages.start(owner.id, member.id);
  const sent = await messages.send(conversation.id, owner.id, 'Atomic direct message');
  assert(sent?.notifications.length === 1, 'Direct Message notification was not persisted.');
  assert(
    sent.recipientUserId === member.id,
    'Direct Message notification targeted the wrong user.',
  );

  const teams = new TeamsRepository();
  const team = await teams.create(
    {
      name: `${marker}-team`,
      primaryFormat: 'FIVE_A_SIDE',
      formationKey: getDefaultFormationKey('FIVE_A_SIDE'),
    },
    owner.id,
  );
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: third.id, role: 'CAPTAIN' },
  });
  const invite = await teams.createInvite(
    team.id,
    owner.id,
    `${marker}-invite-hash`,
    new Date(Date.now() + 86_400_000),
  );
  const acceptance = await teams.acceptInvite(invite.tokenHash, member.id, new Date());
  assert(acceptance.outcome === 'JOINED', 'Team invitation was not accepted.');
  assert(
    acceptance.outcome === 'JOINED' && acceptance.notifications.length === 2,
    'Team invitation notification was not persisted atomically.',
  );
  assert(
    acceptance.outcome === 'JOINED' &&
      new Set(acceptance.notifications.map(({ userId }) => userId)).size === 2 &&
      acceptance.notifications.every(({ userId }) => [owner.id, third.id].includes(userId)) &&
      acceptance.notifications.every(({ userId }) => userId !== member.id),
    'Team invitation actor exclusion or manager targeting failed.',
  );

  const lifecycleMatch = await prisma.match.create({
    data: {
      name: `${marker}-lifecycle`,
      createdBy: { connect: { id: third.id } },
      format: 'FIVE_A_SIDE',
      visibility: 'PRIVATE',
      startsAt: new Date(Date.now() - 60_000),
      durationMinutes: 50,
      feeCents: 0,
      status: 'OPEN',
      venue: {
        create: {
          name: `${marker}-venue`,
          addressLine1: '1 Atomic Road',
          city: 'Johannesburg',
          region: 'Gauteng',
          countryCode: 'ZA',
        },
      },
    },
    select: { id: true, venueId: true },
  });
  const published: Notification[][] = [];
  const publisher = {
    publishPersistedMany: (items: Notification[]) => {
      published.push(items);
      return [];
    },
  } as unknown as NotificationsService;
  const transitions = await Promise.all([
    transitionMatchToStarted(lifecycleMatch.id, publisher),
    transitionMatchToStarted(lifecycleMatch.id, publisher),
  ]);
  assert(
    transitions.filter(Boolean).length === 1,
    'Concurrent lifecycle transitions did not produce exactly one winner.',
  );
  assert(published.flat().length === 1, 'Lifecycle transition notification was duplicated.');
  assert(
    (await prisma.match.findUniqueOrThrow({ where: { id: lifecycleMatch.id } })).status ===
      'IN_PROGRESS',
    'Lifecycle transition did not persist.',
  );

  console.log('Slice 2 atomic notification PostgreSQL smoke test passed.');
}

async function cleanup() {
  await removeTicketJobsSince(smokeStartedAt);
  const markedUsers = await prisma.user.findMany({
    where: { email: { startsWith: markerPrefix } },
    select: { id: true },
  });
  const markedUserIds = markedUsers.map(({ id }) => id);
  const markedMatches = await prisma.match.findMany({
    where: { name: { startsWith: markerPrefix } },
    select: { id: true, venueId: true },
  });
  const markedMatchIds = markedMatches.map(({ id }) => id);
  const markedVenueIds = markedMatches.map(({ venueId }) => venueId);
  const markedTeams = await prisma.team.findMany({
    where: { name: { startsWith: markerPrefix } },
    select: { id: true },
  });
  const markedTeamIds = markedTeams.map(({ id }) => id);
  const markedConversations = markedUserIds.length
    ? await prisma.conversation.findMany({
        where: { participants: { some: { userId: { in: markedUserIds } } } },
        select: { id: true },
      })
    : [];
  const markedConversationIds = markedConversations.map(({ id }) => id);

  await removeTicketRows(markedMatchIds);
  await venueFixture.cleanupMatches(markedMatchIds);
  if (markedMatchIds.length) {
    await prisma.matchScorer.deleteMany({
      where: { matchResult: { matchId: { in: markedMatchIds } } },
    });
    await prisma.matchResult.deleteMany({ where: { matchId: { in: markedMatchIds } } });
    await prisma.match.deleteMany({ where: { id: { in: markedMatchIds } } });
  }
  if (markedVenueIds.length)
    await prisma.venue.deleteMany({ where: { id: { in: markedVenueIds } } });
  if (markedTeamIds.length) await prisma.team.deleteMany({ where: { id: { in: markedTeamIds } } });
  if (markedConversationIds.length)
    await prisma.conversation.deleteMany({ where: { id: { in: markedConversationIds } } });
  await prisma.notification.deleteMany({ where: { dedupeKey: { startsWith: markerPrefix } } });
  await venueFixture.cleanupVenue();
  if (markedUserIds.length) await prisma.user.deleteMany({ where: { id: { in: markedUserIds } } });

  const [users, teams, matches, venues, conversations, notifications] = await Promise.all([
    prisma.user.count({ where: { email: { startsWith: markerPrefix } } }),
    prisma.team.count({ where: { name: { startsWith: markerPrefix } } }),
    prisma.match.count({ where: { name: { startsWith: markerPrefix } } }),
    prisma.venue.count({ where: { name: { startsWith: markerPrefix } } }),
    prisma.conversation.count({ where: { id: { in: markedConversationIds } } }),
    prisma.notification.count({ where: { dedupeKey: { startsWith: markerPrefix } } }),
  ]);
  assert(
    users + teams + matches + venues + conversations + notifications === 0,
    'Atomic notification smoke cleanup left marked rows behind.',
  );
}

try {
  await main();
} finally {
  await cleanup();
  await prisma.$disconnect();
}
