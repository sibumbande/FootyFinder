import {
  createTeamMatchSchema,
  createTeamSchema,
  matchFormatRouteParamSchema,
  saveTeamFormationSchema,
  updateTeamFormationSlotSchema,
  updateTeamMemberRoleSchema,
  updateTeamSchema,
} from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { TeamsService } from './teams.service.js';

const service = new TeamsService();
const userId = (locals: Record<string, unknown>) => String(locals.authUserId);
const teamId = (params: Record<string, unknown>) => String(params.teamId);
const format = (params: Record<string, unknown>) =>
  matchFormatRouteParamSchema.parse(params.format);

export const create: RequestHandler = async (req, res, next) => {
  try {
    res
      .status(201)
      .json({ data: await service.create(createTeamSchema.parse(req.body), userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
export const list: RequestHandler = async (_req, res, next) => {
  try {
    res.json({ data: await service.list(userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
export const get: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.get(teamId(req.params), userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
export const update: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await service.update(
        teamId(req.params),
        updateTeamSchema.parse(req.body),
        userId(res.locals),
      ),
    });
  } catch (error) {
    next(error);
  }
};
export const remove: RequestHandler = async (req, res, next) => {
  try {
    const closed = await service.remove(teamId(req.params), userId(res.locals));
    res.json({ data: { success: true, ...closed } });
  } catch (error) {
    next(error);
  }
};
export const createMatch: RequestHandler = async (req, res, next) => {
  try {
    res.status(201).json({
      data: await service.createMatch(
        teamId(req.params),
        createTeamMatchSchema.parse(req.body),
        userId(res.locals),
      ),
    });
  } catch (error) {
    next(error);
  }
};
export const matches: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.matchesForTeam(teamId(req.params), userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
export const members: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.members(teamId(req.params), userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
export const updateMemberRole: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await service.updateMemberRole(
        teamId(req.params),
        String(req.params.userId),
        updateTeamMemberRoleSchema.parse(req.body).role,
        userId(res.locals),
      ),
    });
  } catch (error) {
    next(error);
  }
};
export const removeMember: RequestHandler = async (req, res, next) => {
  try {
    await service.removeMember(teamId(req.params), String(req.params.userId), userId(res.locals));
    res.json({ data: { success: true } });
  } catch (error) {
    next(error);
  }
};
export const createInvite: RequestHandler = async (req, res, next) => {
  try {
    res
      .status(201)
      .json({ data: await service.createInvite(teamId(req.params), userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
export const listInvites: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.listInvites(teamId(req.params), userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
export const revokeInvite: RequestHandler = async (req, res, next) => {
  try {
    await service.revokeInvite(teamId(req.params), String(req.params.inviteId), userId(res.locals));
    res.json({ data: { success: true } });
  } catch (error) {
    next(error);
  }
};
export const inspectInvite: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.inspectInvite(String(req.params.token)) });
  } catch (error) {
    next(error);
  }
};
export const acceptInvite: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.acceptInvite(String(req.params.token), userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
export const getFormation: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await service.formation(teamId(req.params), format(req.params), userId(res.locals)),
    });
  } catch (error) {
    next(error);
  }
};
export const saveFormation: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await service.saveFormation(
        teamId(req.params),
        format(req.params),
        saveTeamFormationSchema.parse(req.body).formationKey,
        userId(res.locals),
      ),
    });
  } catch (error) {
    next(error);
  }
};
export const updateFormationSlot: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await service.updateFormationSlot(
        teamId(req.params),
        format(req.params),
        String(req.params.slotId),
        updateTeamFormationSlotSchema.parse(req.body),
        userId(res.locals),
      ),
    });
  } catch (error) {
    next(error);
  }
};
export const uploadImage: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.uploadImage(teamId(req.params), userId(res.locals), req.file) });
  } catch (error) {
    next(error);
  }
};
