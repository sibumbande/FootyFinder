import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';
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

async function main() {
  const owner = await world.user('Chat owner', 0);
  const member = await world.user('Chat member', 0);
  const leaver = await world.user('Chat leaver', 0);
  const outsider = await world.user('Chat outsider', 0);
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
  await chat.markRead(team.id, member.id);
  assert((await chat.history(team.id, member.id, { limit: 1 })).unreadCount === 0, 'Reading the chat did not clear the unread count.');

  // Outsiders never; a removed member loses history and sending at once.
  assert(await rejectsWith(() => chat.history(team.id, outsider.id, { limit: 5 }), 'TEAM_FORBIDDEN'), 'An outsider read the team chat.');
  assert(await rejectsWith(() => chat.send(team.id, outsider.id, 'hi'), 'TEAM_FORBIDDEN'), 'An outsider posted in the team chat.');
  await new TeamsRepository().removeMember(team.id, leaver.id);
  assert(await rejectsWith(() => chat.history(team.id, leaver.id, { limit: 5 }), 'TEAM_FORBIDDEN'), 'A removed member still read the history.');
  assert(await rejectsWith(() => chat.send(team.id, leaver.id, 'still here?'), 'TEAM_FORBIDDEN'), 'A removed member still posted.');
  assert(await prisma.teamMessage.count({ where: { teamId: team.id, senderId: leaver.id } }) === 1, 'The retained history lost a removed member\'s message.');

  // A new member's unread count starts when they joined.
  const joiner = await world.user('Chat joiner', 0);
  await prisma.teamMembership.create({ data: { teamId: team.id, userId: joiner.id, role: 'MEMBER' } });
  await chat.send(team.id, owner.id, 'Welcome!');
  const joinerPage = await chat.history(team.id, joiner.id, { limit: 50 });
  assert(joinerPage.unreadCount === 1 && joinerPage.messages.length === 37, 'A new member should see the whole history but only one unread message.');

  // A closed team's chat stays readable but nobody can post.
  await new TeamsRepository().close(team.id, owner.id);
  assert((await chat.history(team.id, member.id, { limit: 5 })).messages.length === 5, 'A closed team\'s history is not readable.');
  assert(await rejectsWith(() => chat.send(team.id, owner.id, 'after closing'), 'TEAM_ARCHIVED'), 'A closed team\'s chat accepted a message.');
  assert(await prisma.durableJob.count({ where: { dedupeKey: { contains: team.id }, type: { contains: 'EMAIL' } } }) === 0, 'Team chat queued an email.');
  console.log('Gate 7 team chat smoke passed (TKT-710).');
}

try {
  await main();
} finally {
  await prisma.teamMessage.deleteMany({ where: { teamId: { in: world.teamIds } } });
  await world.cleanup();
  await prisma.$disconnect();
}
