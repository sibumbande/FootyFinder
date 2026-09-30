import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { getDefaultFormationKey } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { BlocksService } from '../src/modules/social/blocks.service.js';
import { FriendsService } from '../src/modules/social/friends.service.js';
import { TeamMemberInvitesService } from '../src/modules/social/team-member-invites.service.js';
import { TeamsRepository } from '../src/modules/teams/teams.repository.js';
import { assert, rejectsWith, socialWorld } from './social-fixtures.js';
import { deleteTeamWalletFixtures } from './team-wallet-fixtures.js';

const world = socialWorld(`gate9-team-invites-${randomUUID()}`);
const friends = new FriendsService();
const invites = new TeamMemberInvitesService();
const blocks = new BlocksService();
const teamIds: string[] = [];

const befriend = async (a: string, b: string) => {
  const request = await friends.send(a, b);
  await friends.accept(b, request.requestId!);
};

async function main() {
  const [owner, captain, member, friend, stranger, decliner, blocker, late] = await Promise.all(
    ['Owner', 'Captain', 'Member', 'Friend', 'Stranger', 'Decliner', 'Blocker', 'Late'].map((name) => world.player(name)),
  );
  const team = await new TeamsRepository().create({ name: `${world.marker}-FC`, primaryFormat: 'FIVE_A_SIDE', formationKey: getDefaultFormationKey('FIVE_A_SIDE') }, owner!.id);
  teamIds.push(team.id);
  await prisma.teamMembership.createMany({ data: [{ teamId: team.id, userId: captain!.id, role: 'CAPTAIN' }, { teamId: team.id, userId: member!.id, role: 'MEMBER' }] });
  await befriend(captain!.id, friend!.id);
  await befriend(captain!.id, member!.id);
  await befriend(owner!.id, decliner!.id);
  await befriend(owner!.id, blocker!.id);
  await befriend(owner!.id, late!.id);

  // A captain invites a friend; repeating returns the same pending invite.
  const invite = await invites.invite(captain!.id, team.id, friend!.id);
  assert(invite.status === 'PENDING' && invite.team.id === team.id, 'The invite was not created.');
  assert((await invites.invite(captain!.id, team.id, friend!.id)).id === invite.id, 'A second invite was created for the same player.');
  assert(await prisma.notification.count({ where: { userId: friend!.id, type: 'TEAM_INVITE_RECEIVED' } }) === 1, 'The friend was not told once.');
  assert((await invites.mine(friend!.id)).map(({ id }) => id).join() === invite.id, 'The invitee does not see the invite.');
  const picker = await invites.invitableFriends(captain!.id, team.id);
  assert(picker.find(({ player }) => player.id === friend!.id)?.status === 'INVITED', 'The picker did not show the friend as invited.');
  assert(picker.find(({ player }) => player.id === member!.id)?.status === 'MEMBER', 'The picker did not show a member as in the team.');

  // Only the Owner or Captains, only friends (looking-card invites arrive with TKT-909), never yourself or members.
  await rejectsWith(() => invites.invite(member!.id, team.id, stranger!.id), 'TEAM_FORBIDDEN');
  await rejectsWith(() => invites.invite(captain!.id, team.id, stranger!.id), 'TEAM_INVITE_NOT_ELIGIBLE');
  await rejectsWith(() => invites.invite(captain!.id, team.id, member!.id), 'TEAM_INVITE_ALREADY_MEMBER');
  await rejectsWith(() => invites.invite(captain!.id, team.id, captain!.id), 'TEAM_INVITE_SELF');
  await rejectsWith(() => invites.forTeam(member!.id, team.id), 'TEAM_FORBIDDEN');

  // Accepting joins through the normal membership path.
  await rejectsWith(() => invites.respond(stranger!.id, invite.id, true), 'TEAM_INVITE_NOT_FOUND');
  const accepted = await invites.respond(friend!.id, invite.id, true);
  assert(accepted.status === 'ACCEPTED', 'Accepting failed.');
  assert((await prisma.teamMembership.findUnique({ where: { teamId_userId: { teamId: team.id, userId: friend!.id } } }))?.role === 'MEMBER', 'The friend did not join as a member.');
  assert(await prisma.notification.count({ where: { userId: { in: [owner!.id, captain!.id] }, type: 'TEAM_MEMBER_JOINED' } }) === 2, 'The Owner and Captain were not told about the new member.');
  assert(await prisma.notification.count({ where: { userId: captain!.id, type: 'TEAM_INVITE_ANSWERED' } }) === 1, 'The inviter was not told the invite was accepted.');
  await rejectsWith(() => invites.respond(friend!.id, invite.id, true), 'TEAM_INVITE_CLOSED');

  // Declining; the player can be invited again later.
  const toDecline = await invites.invite(owner!.id, team.id, decliner!.id);
  assert((await invites.respond(decliner!.id, toDecline.id, false)).status === 'DECLINED', 'Declining failed.');
  assert(!(await prisma.teamMembership.findUnique({ where: { teamId_userId: { teamId: team.id, userId: decliner!.id } } })), 'Declining added the player.');
  assert((await invites.invite(owner!.id, team.id, decliner!.id)).id !== toDecline.id, 'The player could not be invited again after declining.');

  // 14-day expiry.
  const stale = await invites.invite(owner!.id, team.id, late!.id);
  await prisma.teamMemberInvite.update({ where: { id: stale.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await rejectsWith(() => invites.respond(late!.id, stale.id, true), 'TEAM_INVITE_EXPIRED');

  // A block cancels invites between the two players and prevents new ones.
  const blockedInvite = await invites.invite(owner!.id, team.id, blocker!.id);
  await blocks.block(blocker!.id, owner!.id);
  assert((await prisma.teamMemberInvite.findUniqueOrThrow({ where: { id: blockedInvite.id } })).status === 'CANCELLED', 'Blocking left the invite open.');
  await rejectsWith(() => invites.invite(owner!.id, team.id, blocker!.id), 'TEAM_INVITE_NOT_ELIGIBLE');

  // Cancelling by a captain, and a closed team.
  const pending = (await invites.forTeam(captain!.id, team.id)).find(({ invitee }) => invitee.id === decliner!.id)!;
  assert((await invites.cancel(captain!.id, team.id, pending.id)).status === 'CANCELLED', 'Cancelling failed.');
  await prisma.team.update({ where: { id: team.id }, data: { archivedAt: new Date() } });
  await rejectsWith(() => invites.invite(owner!.id, team.id, decliner!.id), 'TEAM_ARCHIVED');

  console.log('Team member invites smoke passed: Owner/Captain only, friends only, one pending per player, accept joins through the normal membership path with notices, decline and re-invite, 14-day expiry, blocking cancels and refuses, cancel, closed teams refused.');
}

try {
  await main();
} finally {
  await deleteTeamWalletFixtures(teamIds).catch(() => undefined);
  await prisma.team.deleteMany({ where: { id: { in: teamIds } } }).catch(() => undefined);
  await world.cleanup().catch((error: unknown) => {
    console.error('Cleanup failed:', error);
    process.exitCode = 1;
  });
  await prisma.$disconnect();
}
