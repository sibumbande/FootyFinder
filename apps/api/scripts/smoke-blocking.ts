import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';
import { MessagingService } from '../src/modules/messaging/messaging.service.js';
import { BlocksService } from '../src/modules/social/blocks.service.js';
import { FriendsService } from '../src/modules/social/friends.service.js';
import { assert, rejectsWith, socialWorld } from './social-fixtures.js';

const world = socialWorld(`gate9-blocking-${randomUUID()}`);
const friends = new FriendsService();
const blocks = new BlocksService();
const messaging = new MessagingService();
const relationship = async (viewer: string, other: string) => (await friends.relationships(viewer, [other])).get(other)!;

async function main() {
  const [blocker, blocked, bystander] = await Promise.all(['Blocker', 'Blocked', 'Bystander'].map((name) => world.player(name)));

  // Friends with a conversation and a finished match together, plus a pending request to the bystander.
  const request = await friends.send(blocker!.id, blocked!.id);
  await friends.accept(blocked!.id, request.requestId!);
  const conversation = await messaging.start(blocker!.id, blocked!.id);
  await messaging.send(conversation.id, blocked!.id, 'See you Saturday');
  const match = await world.finishedMatch([blocker!.id, bystander!.id], [blocked!.id]);
  const pending = await friends.send(blocked!.id, bystander!.id);

  await blocks.block(blocker!.id, blocked!.id);
  assert((await blocks.block(blocker!.id, blocked!.id)).blocked, 'Blocking twice failed.');

  // The friendship ends; unblocking does not restore it.
  assert(await prisma.friendship.count({ where: { OR: [{ userLowId: blocker!.id }, { userHighId: blocker!.id }] } }) === 0, 'Blocking kept the friendship.');
  const mine = await relationship(blocker!.id, blocked!.id);
  const theirs = await relationship(blocked!.id, blocker!.id);
  assert(mine.state === 'UNAVAILABLE' && mine.blockedByYou === true, 'The blocker did not see an Unblock state.');
  assert(theirs.state === 'UNAVAILABLE' && theirs.blockedByYou === undefined, 'The blocked player could tell they were blocked.');

  // No requests either way.
  await rejectsWith(() => friends.send(blocked!.id, blocker!.id), 'FRIEND_REQUEST_UNAVAILABLE');
  await rejectsWith(() => friends.send(blocker!.id, blocked!.id), 'FRIEND_REQUEST_UNAVAILABLE');

  // Invisible to each other in search, suggestions, friends, requests and played-with.
  const marker = world.marker.slice(-4);
  assert(!(await friends.search(blocked!.id, { q: marker })).some(({ id }) => id === blocker!.id), 'Search showed the blocker to the blocked player.');
  assert(!(await friends.search(blocker!.id, { q: marker })).some(({ id }) => id === blocked!.id), 'Search showed the blocked player to the blocker.');
  assert(!(await friends.search(blocked!.id, {})).some(({ id }) => id === blocker!.id), 'Suggestions showed a blocked player.');
  assert(!(await friends.playedWith(blocked!.id, match.id)).players.some(({ id }) => id === blocker!.id), 'Played-with showed a blocked player.');
  assert((await friends.playedWith(blocked!.id, match.id)).players.some(({ id }) => id === bystander!.id), 'Blocking hid an unrelated player.');
  assert((await friends.summary(blocked!.id)).friends === 0, 'The friends count still included the blocker.');

  // Shared records stay: both remain in the match's Lineup Record.
  assert(await prisma.matchLineupEntry.count({ where: { matchId: match.id } }) === 3, 'Blocking removed someone from a shared lineup.');

  // Direct messages: the history stays, nothing new either way, no new conversation.
  const history = await messaging.get(conversation.id, blocked!.id);
  assert(history.messages?.length === 1 && history.canMessage === false, 'The conversation history or canMessage flag is wrong.');
  await rejectsWith(() => messaging.send(conversation.id, blocked!.id, 'Hello?'), 'MESSAGING_UNAVAILABLE');
  await rejectsWith(() => messaging.send(conversation.id, blocker!.id, 'Bye'), 'MESSAGING_UNAVAILABLE');
  await rejectsWith(() => messaging.start(blocked!.id, blocker!.id), 'MESSAGING_UNAVAILABLE');
  assert(await prisma.notification.count({ where: { userId: blocker!.id, type: 'DIRECT_MESSAGE', createdAt: { gt: new Date(Date.now() - 60_000) } } }) === 1, 'A blocked message still notified.');

  // The pending request to the bystander is untouched; the blocked list shows only the blocker's own blocks.
  assert((await relationship(bystander!.id, blocked!.id)).requestId === pending.requestId, 'Blocking affected someone else\'s request.');
  assert((await blocks.list(blocker!.id)).map(({ id }) => id).join() === blocked!.id, 'The blocked list is wrong.');
  assert((await blocks.list(blocked!.id)).length === 0, 'The blocked player could see who blocked them.');

  // Unblock: requests and messages work again, the friendship is not restored.
  await blocks.unblock(blocker!.id, blocked!.id);
  assert((await relationship(blocked!.id, blocker!.id)).state === 'CAN_REQUEST', 'Unblocking did not allow requests again.');
  assert((await messaging.send(conversation.id, blocker!.id, 'Sorry')).content === 'Sorry', 'Unblocking did not allow messages again.');
  await rejectsWith(() => blocks.block(blocker!.id, blocker!.id), 'BLOCK_SELF');

  console.log('Blocking smoke passed: ends the friendship and pending requests, hides both players from each other in search, suggestions, friends, requests and played-with, refuses requests and DMs both ways (history kept, canMessage false), leaves shared lineups and others\' requests alone, the blocked player cannot tell, unblock restores access but not the friendship.');
}

try {
  await main();
} finally {
  await world.cleanup().catch((error: unknown) => {
    console.error('Cleanup failed:', error);
    process.exitCode = 1;
  });
  await prisma.$disconnect();
}
