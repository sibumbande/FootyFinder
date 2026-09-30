import { sendTeamChatMessageSchema, teamChatQuerySchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { TeamChatService } from './team-chat.service.js';

const service = new TeamChatService();
const userId = (locals: Record<string, unknown>) => String(locals.authUserId);
const teamId = (params: Record<string, unknown>) => String(params.teamId);

export const history: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.history(teamId(req.params), userId(res.locals), teamChatQuerySchema.parse(req.query)) });
  } catch (error) {
    next(error);
  }
};
export const send: RequestHandler = async (req, res, next) => {
  try {
    const { content } = sendTeamChatMessageSchema.parse(req.body);
    res.status(201).json({ data: await service.send(teamId(req.params), userId(res.locals), content) });
  } catch (error) {
    next(error);
  }
};
export const markRead: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.markRead(teamId(req.params), userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
