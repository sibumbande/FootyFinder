import { adminRecruitmentQuerySchema, adminRemoveRecruitmentSchema, blockUserSchema, createTeamMemberInviteSchema, lookingCardSchema, recruitmentPostSchema, recruitmentQuerySchema, relationshipsQuerySchema, sendFriendRequestSchema, socialSearchQuerySchema, socialSettingsSchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { BlocksService } from './blocks.service.js';
import { FriendsService } from './friends.service.js';
import { RecruitmentService } from './recruitment.service.js';
import { TeamMemberInvitesService } from './team-member-invites.service.js';

const friends = new FriendsService();
const blocks = new BlocksService();
const teamInvites = new TeamMemberInvitesService();
const recruitment = new RecruitmentService();
const requestId = (locals: Record<string, unknown>) => String(locals.requestId);
const userId = (locals: Record<string, unknown>) => String(locals.authUserId);
const handle = (work: (req: Parameters<RequestHandler>[0], viewerId: string) => Promise<unknown>, status = 200): RequestHandler =>
  async (req, res, next) => {
    try {
      res.status(status).json({ data: await work(req, userId(res.locals)) });
    } catch (error) {
      next(error);
    }
  };

/** Gate 9 / TKT-901: friends, requests, Discover search and "Players you played with". */
export const summary = handle((_req, viewerId) => friends.summary(viewerId));
export const search = handle((req, viewerId) => friends.search(viewerId, socialSearchQuerySchema.parse(req.query)));
export const relationships = handle((req, viewerId) => friends.relationshipList(viewerId, relationshipsQuerySchema.parse(req.query).userIds));
export const list = handle((_req, viewerId) => friends.friends(viewerId));
export const requests = handle((_req, viewerId) => friends.requests(viewerId));
export const send = handle((req, viewerId) => friends.send(viewerId, sendFriendRequestSchema.parse(req.body).userId), 201);
export const accept = handle((req, viewerId) => friends.accept(viewerId, String(req.params.requestId)));
export const decline = handle((req, viewerId) => friends.close(viewerId, String(req.params.requestId), 'DECLINE'));
export const cancel = handle((req, viewerId) => friends.close(viewerId, String(req.params.requestId), 'CANCEL'));
export const remove = handle((req, viewerId) => friends.remove(viewerId, String(req.params.userId)));
export const settings = handle((_req, viewerId) => friends.settings(viewerId));
export const updateSettings = handle((req, viewerId) => friends.updateSettings(viewerId, socialSettingsSchema.parse(req.body)));
export const playedWith = handle((req, viewerId) => friends.playedWith(viewerId, String(req.params.matchId)));
export const addAll = handle((req, viewerId) => friends.addAll(viewerId, String(req.params.matchId)));

/** Gate 9 / TKT-903: blocking. */
export const blockList = handle((_req, viewerId) => blocks.list(viewerId));
export const block = handle((req, viewerId) => blocks.block(viewerId, blockUserSchema.parse(req.body).userId), 201);
export const unblock = handle((req, viewerId) => blocks.unblock(viewerId, String(req.params.userId)));

/** Gate 9 / TKT-904: personal team invites. */
export const myTeamInvites = handle((_req, viewerId) => teamInvites.mine(viewerId));
export const acceptTeamInvite = handle((req, viewerId) => teamInvites.respond(viewerId, String(req.params.inviteId), true));
export const declineTeamInvite = handle((req, viewerId) => teamInvites.respond(viewerId, String(req.params.inviteId), false));
export const teamMemberInvites = handle((req, viewerId) => teamInvites.forTeam(viewerId, String(req.params.teamId)));
export const invitableFriends = handle((req, viewerId) => teamInvites.invitableFriends(viewerId, String(req.params.teamId)));
export const createTeamMemberInvite = handle((req, viewerId) => {
  const input = createTeamMemberInviteSchema.parse(req.body);
  return teamInvites.invite(viewerId, String(req.params.teamId), input.userId, input.source);
}, 201);
export const cancelTeamMemberInvite = handle((req, viewerId) => teamInvites.cancel(viewerId, String(req.params.teamId), String(req.params.inviteId)));

/** Gate 9 / TKT-909: the team recruitment board. */
export const recruitmentPosts = handle((req, viewerId) => recruitment.listPosts(viewerId, recruitmentQuerySchema.parse(req.query)));
export const lookingPlayers = handle((req, viewerId) => recruitment.listLooking(viewerId, recruitmentQuerySchema.parse(req.query)));
export const myLookingCard = handle((_req, viewerId) => recruitment.myCard(viewerId));
export const updateLookingCard = handle((req, viewerId) => recruitment.updateCard(viewerId, lookingCardSchema.parse(req.body)));
export const askToJoin = handle((req, viewerId) => recruitment.askToJoin(viewerId, String(req.params.postId)), 201);
export const myJoinRequests = handle((_req, viewerId) => recruitment.myJoinRequests(viewerId));
export const cancelJoinRequest = handle((req, viewerId) => recruitment.cancelJoinRequest(viewerId, String(req.params.requestId)));
export const teamRecruitmentPosts = handle((req, viewerId) => recruitment.teamPosts(viewerId, String(req.params.teamId)));
export const createRecruitmentPost = handle((req, viewerId) => recruitment.createPost(viewerId, String(req.params.teamId), recruitmentPostSchema.parse(req.body)), 201);
export const updateRecruitmentPost = handle((req, viewerId) => recruitment.updatePost(viewerId, String(req.params.teamId), String(req.params.postId), recruitmentPostSchema.parse(req.body)));
export const renewRecruitmentPost = handle((req, viewerId) => recruitment.renewPost(viewerId, String(req.params.teamId), String(req.params.postId)));
export const closeRecruitmentPost = handle((req, viewerId) => recruitment.closePost(viewerId, String(req.params.teamId), String(req.params.postId)));
export const teamJoinRequests = handle((req, viewerId) => recruitment.teamJoinRequests(viewerId, String(req.params.teamId)));
export const acceptJoinRequest = handle((req, viewerId) => recruitment.respondJoinRequest(viewerId, String(req.params.teamId), String(req.params.requestId), true));
export const declineJoinRequest = handle((req, viewerId) => recruitment.respondJoinRequest(viewerId, String(req.params.teamId), String(req.params.requestId), false));
export const adminRecruitment = handle((req) => recruitment.adminList(adminRecruitmentQuerySchema.parse(req.query)));
export const adminRemovePost: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await recruitment.adminRemove(userId(res.locals), 'POST', String(req.params.postId), adminRemoveRecruitmentSchema.parse(req.body).reason, requestId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
export const adminRemoveCard: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await recruitment.adminRemove(userId(res.locals), 'CARD', String(req.params.cardId), adminRemoveRecruitmentSchema.parse(req.body).reason, requestId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
