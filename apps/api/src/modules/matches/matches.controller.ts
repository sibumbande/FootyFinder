import {
  changeParticipantTeamSchema,
  discoveryQuerySchema,
  formationSlotUpdateSchema,
  joinMatchSchema,
  resultInputSchema,
  sendLobbyMessageSchema,
  teamMatchAvailabilityQuerySchema,
  teamMatchSideSchema,
  updateMyTeamMatchAvailabilitySchema,
} from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { ChatService } from '../chat/chat.service.js';
import { MatchAvailabilityService } from '../match-availability/match-availability.service.js';
import { createMatchSchema, updateMatchSchema } from './matches.schema.js';
import { MatchesService } from './matches.service.js';
const service = new MatchesService();
const chat = new ChatService();
const availability = new MatchAvailabilityService();
const userId = (locals: Record<string, unknown>) => String(locals.authUserId);
const matchId = (params: Record<string, unknown>) => String(params.id);
export const list: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.list(discoveryQuerySchema.parse(req.query)) });
  } catch (error) {
    next(error);
  }
};
export const get: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.get(matchId(req.params), userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
export const invite: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.getByInvite(String(req.params.token)) });
  } catch (error) {
    next(error);
  }
};
export const create: RequestHandler = async (req, res, next) => {
  try {
    res
      .status(201)
      .json({ data: await service.create(createMatchSchema.parse(req.body), userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
export const update: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await service.update(
        matchId(req.params),
        updateMatchSchema.parse(req.body),
        userId(res.locals),
      ),
    });
  } catch (error) {
    next(error);
  }
};
export const remove: RequestHandler = async (req, res, next) => {
  try {
    await service.remove(matchId(req.params), userId(res.locals));
    res.json({ data: { success: true } });
  } catch (error) {
    next(error);
  }
};
export const ready: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.ready(matchId(req.params), userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
export const join: RequestHandler = async (req, res, next) => {
  try {
    res.status(201).json({
      data: await service.join(
        matchId(req.params),
        userId(res.locals),
        joinMatchSchema.parse(req.body),
        String(req.header('Idempotency-Key') ?? ''),
      ),
    });
  } catch (error) {
    next(error);
  }
};
export const cancellationQuote: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.cancellationQuote(matchId(req.params), userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
export const cancellationStatus: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.cancellationStatus(matchId(req.params), userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
export const leave: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.leave(matchId(req.params), userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
export const formation: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await service.updateFormation(
        matchId(req.params),
        String(req.params.slotId),
        formationSlotUpdateSchema.parse(req.body),
        userId(res.locals),
      ),
    });
  } catch (error) {
    next(error);
  }
};
export const changeTeam: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await service.changeTeam(
        matchId(req.params),
        String(req.params.participantId),
        changeParticipantTeamSchema.parse(req.body),
        userId(res.locals),
      ),
    });
  } catch (error) {
    next(error);
  }
};
export const submitResult: RequestHandler = async (req, res, next) => {
  try {
    res.status(201).json({
      data: await service.submitResult(
        matchId(req.params),
        resultInputSchema.parse(req.body),
        userId(res.locals),
      ),
    });
  } catch (error) {
    next(error);
  }
};
export const participants: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.participants(matchId(req.params), userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
export const requestAvailability: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await availability.request(
        matchId(req.params),
        teamMatchSideSchema.parse(req.params.side),
        userId(res.locals),
      ),
    });
  } catch (error) {
    next(error);
  }
};
export const teamAvailability: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await availability.get(
        matchId(req.params),
        teamMatchSideSchema.parse(req.params.side),
        teamMatchAvailabilityQuerySchema.parse(req.query),
        userId(res.locals),
      ),
    });
  } catch (error) {
    next(error);
  }
};
export const updateMyAvailability: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await availability.updateMine(
        matchId(req.params),
        teamMatchSideSchema.parse(req.params.side),
        updateMyTeamMatchAvailabilitySchema.parse(req.body),
        userId(res.locals),
      ),
    });
  } catch (error) {
    next(error);
  }
};
export const messages: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await chat.history(matchId(req.params), userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
export const sendMessage: RequestHandler = async (req, res, next) => {
  try {
    res.status(201).json({
      data: await chat.send(
        matchId(req.params),
        userId(res.locals),
        sendLobbyMessageSchema.parse(req.body).content,
      ),
    });
  } catch (error) {
    next(error);
  }
};
