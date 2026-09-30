import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';
import { FriendsService } from '../src/modules/social/friends.service.js';
import { assert, rejectsWith, socialWorld } from './social-fixtures.js';

const world = socialWorld(`gate9-friends-${randomUUID()}`);
const friends = new FriendsService();
const extraUserIds: string[] = [];
const state = async (viewer: string, other: string) => (await friends.relationships(viewer, [other])).get(other)!.state;

async function main() {
  const [a, b, c, d, e, f, g] = await Promise.all(['Ada', 'Ben', 'Cal', 'Dee', 'Eve', 'Fay', 'Gus'].map((name) => world.player(name)));
  const off = await world.player('Off', { friendRequestsEnabled: false });

  // Send, idempotent resend, accept, remove.
  const sent = await friends.send(a!.id, b!.id);
  assert(sent.state === 'REQUESTED' && sent.requestId, 'A request was not created.');
  assert((await friends.send(a!.id, b!.id)).requestId === sent.requestId, 'A second request was created for the same pair.');
  assert((await state(b!.id, a!.id)) === 'INCOMING', 'The recipient did not see an incoming request.');
  assert(await prisma.notification.count({ where: { userId: b!.id, type: 'FRIEND_REQUEST_RECEIVED' } }) === 1, 'The recipient was not notified once.');
  assert((await friends.accept(b!.id, sent.requestId!)).state === 'FRIENDS', 'Accepting did not make friends.');
  assert((await state(a!.id, b!.id)) === 'FRIENDS' && (await state(b!.id, a!.id)) === 'FRIENDS', 'Friendship is not symmetric.');
  assert(await prisma.notification.count({ where: { userId: a!.id, type: 'FRIEND_REQUEST_ACCEPTED' } }) === 1, 'The requester was not told about the accept.');
  assert((await friends.summary(a!.id)).friends === 1, 'The friends count is wrong.');
  await friends.remove(a!.id, b!.id);
  assert((await state(a!.id, b!.id)) === 'CAN_REQUEST', 'Removing a friend did not end the friendship.');
  await rejectsWith(() => friends.send(a!.id, a!.id), 'FRIEND_REQUEST_SELF');
  await rejectsWith(() => friends.accept(a!.id, sent.requestId!), 'FRIEND_REQUEST_NOT_FOUND');

  // Two players asking each other at the same moment end up friends, with one friendship.
  await Promise.all([friends.send(c!.id, d!.id), friends.send(d!.id, c!.id)]);
  assert((await state(c!.id, d!.id)) === 'FRIENDS', 'Crossed requests did not end as friends.');
  assert(await prisma.friendship.count({ where: { OR: [{ userLowId: c!.id }, { userHighId: c!.id }] } }) === 1, 'Crossed requests created two friendships.');
  assert(await prisma.friendRequest.count({ where: { status: 'PENDING', OR: [{ requesterId: c!.id }, { recipientId: c!.id }] } }) === 0, 'A crossed request stayed pending.');

  // Decline is silent and the requester may ask again at once (CEO D6); cancel by the requester.
  const toDecline = await friends.send(e!.id, f!.id);
  assert((await friends.close(f!.id, toDecline.requestId!, 'DECLINE')).state === 'CAN_REQUEST', 'Declining left a request open.');
  assert(await prisma.notification.count({ where: { userId: e!.id } }) === 0, 'A decline notified the requester.');
  const again = await friends.send(e!.id, f!.id);
  assert(again.state === 'REQUESTED', 'The requester could not ask again after a decline.');
  assert((await friends.close(e!.id, again.requestId!, 'CANCEL')).state === 'CAN_REQUEST', 'Cancelling left a request open.');

  // Incoming requests turned off.
  assert((await state(a!.id, off.id)) === 'UNAVAILABLE', 'A player with requests off showed an Add friend button.');
  await rejectsWith(() => friends.send(a!.id, off.id), 'FRIEND_REQUESTS_DISABLED');

  // 30-day expiry: an old request no longer counts, cannot be accepted and does not block a new one.
  const stale = await friends.send(g!.id, a!.id);
  await prisma.friendRequest.update({ where: { id: stale.requestId! }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert((await state(g!.id, a!.id)) === 'CAN_REQUEST', 'An expired request still showed as pending.');
  await rejectsWith(() => friends.accept(a!.id, stale.requestId!), 'FRIEND_REQUEST_EXPIRED');
  assert((await friends.send(g!.id, a!.id)).state === 'REQUESTED', 'An expired request blocked a new one.');

  // "Players you played with": both sides, not yourself, not "did not play"; players only.
  const [h1, h2, a1, dnp, outsider, referee] = await Promise.all(['H1', 'H2', 'A1', 'Dnp', 'Out', 'Ref'].map((name) => world.player(name)));
  const match = await world.finishedMatch([h1!.id, h2!.id], [a1!.id, dnp!.id], { didNotPlay: [dnp!.id], refereeUserId: referee!.id });
  const played = await friends.playedWith(h1!.id, match.id);
  const ids = played.players.map(({ id }) => id);
  assert(ids.length === 2 && ids.includes(h2!.id) && ids.includes(a1!.id), `Played-with list is wrong: ${JSON.stringify(ids)}`);
  assert(played.players.find(({ id }) => id === h2!.id)!.teammate && !played.players.find(({ id }) => id === a1!.id)!.teammate, 'Teammates and opponents were mixed up.');
  assert(JSON.stringify(played).match(/email|dateOfBirth|balance|price/i) === null, 'The played-with list exposed private data.');
  await rejectsWith(() => friends.playedWith(outsider!.id, match.id), 'PLAYED_WITH_FORBIDDEN');
  assert((await friends.playedWith(referee!.id, match.id)).players.length === 3, 'The referee could not see who played.');
  const addAll = await friends.addAll(h1!.id, match.id);
  assert(addAll.sent === 2 && !addAll.limitReached, `Add all sent ${addAll.sent}.`);
  assert((await friends.addAll(h1!.id, match.id)).sent === 0, 'Add all sent duplicate requests.');

  // Discover: search excludes yourself and friends; with no search it suggests lineup-mates.
  const found = await friends.search(a!.id, { q: world.marker.slice(-4) });
  assert(!found.some(({ id }) => id === a!.id), 'Search returned yourself.');
  const suggestions = await friends.search(h2!.id, {});
  assert(suggestions.some(({ id }) => id === a1!.id), 'Suggestions did not include a player from your match.');

  // 20 new requests a day, except to people you shared a Lineup Record with; 100 pending at most.
  const sender = await world.player('Sender');
  const mate = await world.player('Mate');
  await world.finishedMatch([sender.id], [mate.id]);
  const strangers = await Promise.all(Array.from({ length: 21 }, (_, n) => world.player(`Stranger${n}`)));
  for (const stranger of strangers.slice(0, 20)) await friends.send(sender.id, stranger.id);
  await rejectsWith(() => friends.send(sender.id, strangers[20]!.id), 'FRIEND_REQUEST_DAILY_LIMIT');
  assert((await friends.send(sender.id, mate.id)).state === 'REQUESTED', 'The daily limit blocked a request to a lineup-mate.');
  await friends.close(sender.id, (await friends.relationships(sender.id, [mate.id])).get(mate.id)!.requestId!, 'CANCEL');
  const filler = await Promise.all(Array.from({ length: 80 }, (_, n) => prisma.user.create({
    data: { email: `${world.marker}-filler-${n}@smoke.invalid`, username: `g9f_${world.marker.slice(-6)}_${n}`, passwordHash: 'smoke-test-only' },
  })));
  extraUserIds.push(...filler.map(({ id }) => id));
  await prisma.friendRequest.createMany({
    data: filler.map((user) => ({ requesterId: sender.id, recipientId: user.id, pairKey: [sender.id, user.id].sort().join(':'), sharedLineup: true, expiresAt: new Date(Date.now() + 86_400_000) })),
  });
  await rejectsWith(() => friends.send(sender.id, mate.id), 'FRIEND_REQUEST_PENDING_LIMIT');

  console.log('Friends smoke passed: send/accept/remove, crossed requests become one friendship, silent decline with an immediate re-ask, cancel, requests-off, 30-day expiry, played-with (both sides, no DNP, players and referee only), Add all, Discover, 20/day with the lineup-mate exemption, 100 pending cap.');
}

try {
  await main();
} finally {
  await prisma.user.deleteMany({ where: { id: { in: extraUserIds } } }).catch(() => undefined);
  await world.cleanup().catch((error: unknown) => {
    console.error('Cleanup failed:', error);
    process.exitCode = 1;
  });
  await prisma.$disconnect();
}
