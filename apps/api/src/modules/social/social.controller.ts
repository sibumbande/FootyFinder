import { blockUserSchema, relationshipsQuerySchema, sendFriendRequestSchema, socialSearchQuerySchema, socialSettingsSchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { BlocksService } from './blocks.service.js';
import { FriendsService } from './friends.service.js';

const friends = new FriendsService();
const blocks = new BlocksService();
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
