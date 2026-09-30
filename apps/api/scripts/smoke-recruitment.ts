import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { getDefaultFormationKey, recruitmentPostSchema, type RecruitmentPostInput } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { ModerationService } from '../src/modules/moderation/moderation.service.js';
import { BlocksService } from '../src/modules/social/blocks.service.js';
import { RecruitmentService } from '../src/modules/social/recruitment.service.js';
import { TeamMemberInvitesService } from '../src/modules/social/team-member-invites.service.js';
import { TeamsRepository } from '../src/modules/teams/teams.repository.js';
import { assert, rejectsWith, socialWorld } from './social-fixtures.js';
import { deleteTeamWalletFixtures } from './team-wallet-fixtures.js';

/**
 * Gate 9 / TKT-909 on PostgreSQL: the team recruitment board. Admin removals write append-only audit
 * rows, so the smoke's admin account is retained in the disposable database (like the settlement
 * smokes' admins).
 */
const world = socialWorld(`gate9-recruit-${randomUUID()}`);
const recruitment = new RecruitmentService();
const invites = new TeamMemberInvitesService();
const blocks = new BlocksService();
const moderation = new ModerationService();
const teamsRepository = new TeamsRepository();
const teamIds: string[] = [];

const post: RecruitmentPostInput = { positions: ['GOALKEEPER', 'DEFENDER'], playersWanted: 2, format: 'FIVE_A_SIDE', level: 'COMPETITIVE', days: [2, 4], times: ['EVENING'], area: 'Woodstock', note: 'Tuesday and Thursday evenings.' };
const newTeam = async (label: string, ownerId: string, captainId?: string) => {
  const team = await teamsRepository.create({ name: `${world.marker}-${label}`, primaryFormat: 'FIVE_A_SIDE', formationKey: getDefaultFormationKey('FIVE_A_SIDE') }, ownerId);
  teamIds.push(team.id);
  if (captainId) await prisma.teamMembership.create({ data: { teamId: team.id, userId: captainId, role: 'CAPTAIN' } });
  return team;
};
const visible = async (viewerId: string | null, postId: string, filters = {}) => (await recruitment.listPosts(viewerId, filters)).some(({ id }) => id === postId);

async function main() {
  const [owner, captain, member, p1, p2, p3, p4, p5, p6, p7, owner2] = await Promise.all(
    ['Owner', 'Captain', 'Member', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'Owner2'].map((name) => world.player(name)),
  );
  const team = await newTeam('FC', owner!.id, captain!.id);
  await prisma.teamMembership.create({ data: { teamId: team.id, userId: member!.id, role: 'MEMBER' } });

  // Posts: Owner or Captains only; the note is at most 300 characters; any number of posts.
  const created = await recruitment.createPost(owner!.id, team.id, post);
  await recruitment.createPost(captain!.id, team.id, { ...post, positions: ['FORWARD'], playersWanted: 5, format: 'ELEVEN_A_SIDE', level: 'CASUAL', area: 'Observatory' });
  await rejectsWith(() => recruitment.createPost(member!.id, team.id, post), 'TEAM_FORBIDDEN');
  assert(!recruitmentPostSchema.safeParse({ ...post, note: 'x'.repeat(301) }).success, 'A 301-character note was accepted.');
  assert(!recruitmentPostSchema.safeParse({ ...post, positions: [] }).success, 'A post with no positions was accepted.');

  // The board and its filters.
  assert(await visible(p1!.id, created.id), 'The post is not on the board.');
  assert(await visible(p1!.id, created.id, { format: 'FIVE_A_SIDE', level: 'COMPETITIVE', position: 'GOALKEEPER', area: 'wood' }), 'Matching filters hid the post.');
  assert(!(await visible(p1!.id, created.id, { format: 'SEVEN_A_SIDE' })) && !(await visible(p1!.id, created.id, { position: 'FORWARD' })), 'Non-matching filters showed the post.');
  const onBoard = (await recruitment.listPosts(p1!.id, {})).find(({ id }) => id === created.id)!;
  assert(JSON.stringify(onBoard).match(/email|dateOfBirth|balance|priceCents/i) === null, 'The post exposed private data.');

  // Ask to join: Owner and Captains told; one pending per team; accept joins the team.
  const request = await recruitment.askToJoin(p1!.id, created.id);
  assert((await recruitment.askToJoin(p1!.id, created.id)).id === request.id, 'A second pending request was created.');
  assert(await prisma.notification.count({ where: { userId: { in: [owner!.id, captain!.id] }, type: 'TEAM_JOIN_REQUEST_RECEIVED' } }) === 2, 'The Owner and Captain were not told.');
  assert((await recruitment.listPosts(p1!.id, {})).find(({ id }) => id === created.id)!.viewerRequest?.id === request.id, 'The board did not show the pending request.');
  await rejectsWith(() => recruitment.teamJoinRequests(member!.id, team.id), 'TEAM_FORBIDDEN');
  await recruitment.respondJoinRequest(captain!.id, team.id, request.id, true);
  assert(await prisma.teamMembership.findUnique({ where: { teamId_userId: { teamId: team.id, userId: p1!.id } } }), 'Accepting did not add the player.');
  assert(await prisma.notification.count({ where: { userId: p1!.id, type: 'TEAM_JOIN_REQUEST_ANSWERED' } }) === 1, 'The player was not told.');
  assert((await recruitment.teamPosts(owner!.id, team.id)).find(({ id }) => id === created.id)!.joinedCount === 1, 'The joined count is wrong.');
  await rejectsWith(() => recruitment.askToJoin(p1!.id, created.id), 'JOIN_REQUEST_ALREADY_MEMBER');

  // Decline, ask again, expiry after 14 days, cancel.
  const declined = await recruitment.askToJoin(p2!.id, created.id);
  await recruitment.respondJoinRequest(owner!.id, team.id, declined.id, false);
  const again = await recruitment.askToJoin(p2!.id, created.id);
  assert(again.id !== declined.id, 'The player could not ask again after a decline.');
  await prisma.teamJoinRequest.update({ where: { id: again.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await rejectsWith(() => recruitment.respondJoinRequest(owner!.id, team.id, again.id, true), 'JOIN_REQUEST_EXPIRED');
  const toCancel = await recruitment.askToJoin(p2!.id, created.id);
  assert((await recruitment.cancelJoinRequest(p2!.id, toCancel.id)).status === 'CANCELLED', 'Cancelling failed.');

  // At most 10 pending requests per player.
  for (let n = 0; n < 11; n += 1) {
    const other = await newTeam(`cap-${n}`, owner2!.id);
    const otherPost = await recruitment.createPost(owner2!.id, other.id, post);
    if (n < 10) await recruitment.askToJoin(p3!.id, otherPost.id);
    else await rejectsWith(() => recruitment.askToJoin(p3!.id, otherPost.id), 'JOIN_REQUEST_PENDING_LIMIT');
  }

  // Posts expire after 30 days, can be renewed, and can be closed.
  await prisma.teamRecruitmentPost.update({ where: { id: created.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert(!(await visible(p6!.id, created.id)), 'An expired post stayed on the board.');
  await rejectsWith(() => recruitment.askToJoin(p6!.id, created.id), 'RECRUITMENT_POST_NOT_FOUND');
  await recruitment.renewPost(owner!.id, team.id, created.id);
  assert(await visible(p6!.id, created.id), 'Renewing did not bring the post back.');

  // Looking cards: off by default; listed while on; a LOOKING invite; joining switches it off.
  assert(!(await recruitment.myCard(p4!.id)).enabled, 'A looking card was on by default.');
  await recruitment.updateCard(p4!.id, { enabled: true, positions: ['MIDFIELDER'], area: 'Salt River', days: [6], times: ['MORNING'], note: 'Keen for weekends' });
  assert((await recruitment.listLooking(owner!.id, { position: 'MIDFIELDER' })).some(({ player }) => player.id === p4!.id), 'The looking card is not listed.');
  await rejectsWith(() => invites.invite(owner!.id, team.id, p7!.id, 'LOOKING'), 'TEAM_INVITE_NOT_ELIGIBLE');
  const lookingInvite = await invites.invite(owner!.id, team.id, p4!.id, 'LOOKING');
  await invites.respond(p4!.id, lookingInvite.id, true);
  assert(!(await recruitment.myCard(p4!.id)).enabled, 'Joining a team did not switch the looking card off.');
  assert(!(await recruitment.listLooking(owner!.id, {})).some(({ player }) => player.id === p4!.id), 'A switched-off card stayed listed.');

  // Blocking hides posts and cards both ways and cancels requests to that team.
  await recruitment.updateCard(p5!.id, { enabled: true, positions: ['FORWARD'], days: [], times: [] });
  const blockedRequest = await recruitment.askToJoin(p5!.id, created.id);
  await blocks.block(p5!.id, captain!.id);
  assert(!(await visible(p5!.id, created.id)), 'A blocked player still saw the team\'s post.');
  assert(!(await recruitment.listLooking(captain!.id, {})).some(({ player }) => player.id === p5!.id), 'The captain still saw the blocker\'s card.');
  assert((await prisma.teamJoinRequest.findUniqueOrThrow({ where: { id: blockedRequest.id } })).status === 'CANCELLED', 'Blocking left the join request open.');
  await rejectsWith(() => recruitment.askToJoin(p5!.id, created.id), 'RECRUITMENT_POST_NOT_FOUND');

  // Reports and admin removal (audited, reports resolved, removed posts can't be renewed, removed cards stay off).
  const admin = await prisma.user.create({ data: { email: `${randomUUID()}-recruit-admin@retained.invalid`, username: `g9adm_${randomUUID().slice(0, 12)}`, passwordHash: 'smoke-test-only', platformRole: 'ADMIN' } });
  await moderation.createReport(p6!.id, { targetType: 'RECRUITMENT_POST', targetId: created.id, reason: 'SPAM' });
  await rejectsWith(() => moderation.createReport(owner!.id, { targetType: 'RECRUITMENT_POST', targetId: created.id, reason: 'SPAM' }), 'REPORT_SELF_NOT_ALLOWED');
  assert((await recruitment.adminList({ kind: 'POST', queue: 'reported' })).some(({ id, openReports }) => id === created.id && openReports === 1), 'The reported post is not in the admin queue.');
  await recruitment.adminRemove(admin.id, 'POST', created.id, 'Spam post', 'smoke');
  assert(!(await visible(p6!.id, created.id)), 'A removed post stayed on the board.');
  await rejectsWith(() => recruitment.renewPost(owner!.id, team.id, created.id), 'RECRUITMENT_POST_REMOVED');
  assert((await prisma.moderationReport.findFirstOrThrow({ where: { targetId: created.id } })).status === 'RESOLVED', 'The report was not resolved.');
  const card = await prisma.playerLookingCard.findUniqueOrThrow({ where: { userId: p5!.id } });
  await moderation.createReport(p6!.id, { targetType: 'LOOKING_CARD', targetId: card.id, reason: 'ABUSE' });
  await recruitment.adminRemove(admin.id, 'CARD', card.id, 'Abusive note', 'smoke');
  await rejectsWith(() => recruitment.updateCard(p5!.id, { enabled: true, positions: ['FORWARD'], days: [], times: [] }), 'LOOKING_CARD_REMOVED');
  assert(await prisma.adminAuditLog.count({ where: { actorUserId: admin.id, action: { in: ['RECRUITMENT_POST_REMOVED', 'LOOKING_CARD_REMOVED'] } } }) === 2, 'Removals were not audited.');

  // Closing hides a post.
  const closing = await recruitment.createPost(owner!.id, team.id, post);
  await recruitment.closePost(owner!.id, team.id, closing.id);
  assert(!(await visible(p6!.id, closing.id)), 'A closed post stayed on the board.');

  console.log('Recruitment smoke passed: Owner/Captain posts with filters, ask to join (managers told, one pending, accept joins, decline and re-ask, 14-day expiry, cancel, 10 pending max), 30-day post expiry and renewal, close, looking cards (off by default, LOOKING invites, off after joining), blocking both ways, reports and audited admin removal.');
}

try {
  await main();
} finally {
  await prisma.moderationReport.deleteMany({ where: { reporter: { email: { startsWith: world.marker } } } }).catch(() => undefined);
  await deleteTeamWalletFixtures(teamIds).catch(() => undefined);
  await prisma.team.deleteMany({ where: { id: { in: teamIds } } }).catch(() => undefined);
  await world.cleanup().catch((error: unknown) => {
    console.error('Cleanup failed:', error);
    process.exitCode = 1;
  });
  await prisma.$disconnect();
}
