import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import { SocketEvents, type TeamChatMessage } from '@footy-finder/shared';
import { app } from '../src/app.js';
import { allowedOrigins } from '../src/config/cors.js';
import { prisma } from '../src/database/prisma.js';
import { SessionsService } from '../src/modules/auth/sessions.service.js';
import { createSocketServer } from '../src/socket/create-socket-server.js';
import { TeamsService } from '../src/modules/teams/teams.service.js';
import { TeamChatService } from '../src/modules/team-chat/team-chat.service.js';
import { TeamsRepository } from '../src/modules/teams/teams.repository.js';
import { assert, rejectsWith, teamMatchWorld } from './team-match-fixtures.js';

/**
 * Gate 7 / TKT-710 on PostgreSQL (section 3A "Team chat"): one permanent team conversation.
 * Current members read the retained history and send; outsiders never; a removed member loses
 * all access at once; history pages oldest-first; unread counts ignore your own messages and
 * start when you joined; a closed team's chat is read-only.
 */
const world = teamMatchWorld(`gate7-chat-${randomUUID()}`);
const chat = new TeamChatService();
const clients: ClientSocket[] = [];
let httpServer: ReturnType<typeof createServer> | undefined;
let io: ReturnType<typeof createSocketServer> | undefined;
const waitFor = async (condition: () => boolean, message: string) => {
  const deadline = Date.now() + 3_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
/** A connected socket for this user that has asked to join the team room and records messages. */
async function listen(url: string, userId: string, teamId: string) {
  // The socket accepts only active, verified, onboarded accounts.
  await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date(), onboardingCompletedAt: new Date() } });
  const { token } = await new SessionsService().issue(userId, { ip: '127.0.0.1', userAgent: 'team-chat-smoke' });
  const socket = await new Promise<ClientSocket>((resolve, reject) => {
    const client = createClient(url, { auth: { token }, extraHeaders: { Origin: allowedOrigins[0]! }, forceNew: true, reconnection: false });
    client.once('connect', () => resolve(client));
    client.once('connect_error', reject);
  });
  clients.push(socket);
  const received: string[] = [];
  socket.on(SocketEvents.teamChatMessage, (message: TeamChatMessage) => received.push(message.content));
  socket.emit(SocketEvents.joinTeamRoom, { teamId });
  return received;
}
const notices = (userId: string) => prisma.notification.findMany({ where: { userId, type: 'TEAM_CHAT_UNREAD' }, orderBy: { createdAt: 'asc' } });

async function main() {
  const owner = await world.user('Chat owner');
  const member = await world.user('Chat member');
  const leaver = await world.user('Chat leaver');
  const outsider = await world.user('Chat outsider');
  const team = await world.team('chat', owner.id, [{ userId: member.id, role: 'MEMBER' }, { userId: leaver.id, role: 'MEMBER' }]);

  for (let index = 0; index < 35; index += 1) await chat.send(team.id, owner.id, `Message ${index}`);
  await chat.send(team.id, leaver.id, 'Leaver was here');
  const first = await chat.history(team.id, member.id, { limit: 30 });
  assert(first.messages.length === 30 && first.messages[29]!.content === 'Leaver was here' && first.olderCursor, 'The newest page is wrong.');
  assert(first.messages[0]!.createdAt <= first.messages[29]!.createdAt, 'A page is not oldest first.');
  const second = await chat.history(team.id, member.id, { limit: 30, before: first.olderCursor! });
  assert(second.messages.length === 6 && second.messages[0]!.content === 'Message 0' && second.olderCursor === null, 'The retained history did not page back to the start.');
  assert(first.unreadCount === 36, `A member should have 36 unread messages, saw ${first.unreadCount}.`);
  assert((await chat.history(team.id, owner.id, { limit: 1 })).unreadCount === 1, 'Your own messages counted as unread.');
  // TKT-711: one notice per member per read cycle, none for your own messages.
  assert((await notices(member.id)).length === 1, 'A member did not get exactly one notice for 36 unread messages.');
  assert((await notices(owner.id)).length === 1, 'The owner got a notice for their own messages.');
  await chat.markRead(team.id, member.id);
  assert((await notices(member.id)).every(({ readAt }) => readAt), 'Reading the chat did not mark its notice read.');
  assert((await chat.history(team.id, member.id, { limit: 1 })).unreadCount === 0, 'Reading the chat did not clear the unread count.');

  // Outsiders never; a removed member loses history and sending at once.
  assert(await rejectsWith(() => chat.history(team.id, outsider.id, { limit: 5 }), 'TEAM_FORBIDDEN'), 'An outsider read the team chat.');
  assert(await rejectsWith(() => chat.send(team.id, outsider.id, 'hi'), 'TEAM_FORBIDDEN'), 'An outsider posted in the team chat.');
  await new TeamsRepository().removeMember(team.id, leaver.id);
  assert(await rejectsWith(() => chat.history(team.id, leaver.id, { limit: 5 }), 'TEAM_FORBIDDEN'), 'A removed member still read the history.');
  assert(await rejectsWith(() => chat.send(team.id, leaver.id, 'still here?'), 'TEAM_FORBIDDEN'), 'A removed member still posted.');
  assert(await prisma.teamMessage.count({ where: { teamId: team.id, senderId: leaver.id } }) === 1, 'The retained history lost a removed member\'s message.');

  // A new member's unread count starts when they joined.
  const joiner = await world.user('Chat joiner');
  await prisma.teamMembership.create({ data: { teamId: team.id, userId: joiner.id, role: 'MEMBER' } });
  await chat.send(team.id, owner.id, 'Welcome!');
  const joinerPage = await chat.history(team.id, joiner.id, { limit: 50 });
  const memberNotices = await notices(member.id);
  assert(memberNotices.length === 2 && !memberNotices[1]!.readAt, 'A new message after reading did not start one new notice.');
  assert((await notices(joiner.id)).length === 1, 'A new member did not get one notice.');
  assert(joinerPage.unreadCount === 1 && joinerPage.messages.length === 37, 'A new member should see the whole history but only one unread message.');

  // TKT-711 realtime: members in the team room get messages live; outsiders never; a removed
  // member is evicted from the room at once.
  httpServer = createServer(app);
  io = createSocketServer(httpServer);
  await new Promise<void>((resolve) => httpServer!.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  assert(address && typeof address !== 'string', 'The socket smoke server did not bind.');
  const url = `http://127.0.0.1:${address.port}`;
  const ownerFeed = await listen(url, owner.id, team.id);
  const memberFeed = await listen(url, member.id, team.id);
  const outsiderFeed = await listen(url, outsider.id, team.id);
  await waitFor(() => [...io!.sockets.sockets.values()].filter((socket) => socket.rooms.has(`team:${team.id}`)).length === 2,
    'Exactly the two members should be in the team room.');
  await chat.send(team.id, joiner.id, 'Live one');
  await waitFor(() => ownerFeed.includes('Live one') && memberFeed.includes('Live one'), 'Members did not receive the message live.');
  await new TeamsService().removeMember(team.id, member.id, owner.id);
  await waitFor(() => [...io!.sockets.sockets.values()].filter((socket) => socket.rooms.has(`team:${team.id}`)).length === 1,
    'The removed member was not evicted from the team room.');
  await chat.send(team.id, owner.id, 'After removal');
  await waitFor(() => ownerFeed.includes('After removal'), 'The owner did not receive the message after the removal.');
  assert(!memberFeed.includes('After removal') && outsiderFeed.length === 0, 'A removed member or an outsider received team chat.');

  // A closed team's chat stays readable but nobody can post.
  await new TeamsRepository().close(team.id, owner.id);
  assert((await chat.history(team.id, owner.id, { limit: 5 })).messages.length === 5, 'A closed team\'s history is not readable.');
  assert(await rejectsWith(() => chat.send(team.id, owner.id, 'after closing'), 'TEAM_ARCHIVED'), 'A closed team\'s chat accepted a message.');
  assert(await prisma.durableJob.count({ where: { dedupeKey: { contains: team.id }, type: { contains: 'EMAIL' } } }) === 0, 'Team chat queued an email.');
  console.log('Gate 7 team chat smoke passed (TKT-710 history and access, TKT-711 realtime room and first-unread notices).');
}

try {
  await main();
} finally {
  for (const client of clients) client.disconnect();
  io?.close();
  if (httpServer?.listening) await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
  await prisma.authSession.deleteMany({ where: { userId: { in: world.userIds } } });
  await prisma.teamMessage.deleteMany({ where: { teamId: { in: world.teamIds } } });
  await world.cleanup();
  await prisma.$disconnect();
}
