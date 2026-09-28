import {
  changeParticipantTeamSchema,
  assignTeamMatchStarterSchema,
  discoveryQuerySchema,
  formationSlotUpdateSchema,
  joinMatchSchema,
  resultInputSchema,
  sendLobbyMessageSchema,
  openTeamMatchLineupSlotSchema,
  publicMatchSlugSchema,
  removeTeamMatchStarterSchema,
  teamMatchAvailabilityQuerySchema,
  teamMatchSideSchema,
  updateMyTeamMatchAvailabilitySchema,
  updateTeamMatchLineupSlotPositionSchema,
} from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { ChatService } from '../chat/chat.service.js';
import { MatchAvailabilityService } from '../match-availability/match-availability.service.js';
import { MatchLineupService } from '../match-lineup/match-lineup.service.js';
import { createMatchSchema, updateMatchSchema } from './matches.schema.js';
import { MatchesService } from './matches.service.js';
const service = new MatchesService();
const chat = new ChatService();
const availability = new MatchAvailabilityService();
const lineups = new MatchLineupService();
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
export const getByPublicSlug: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await service.getByPublicSlug(
        publicMatchSlugSchema.parse(req.params.slug),
        userId(res.locals),
      ),
    });
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
export const rotateInvite: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.rotateInvite(matchId(req.params), userId(res.locals)) });
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
export const claimPosition: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await service.claimPosition(
        matchId(req.params),
        String(req.params.slotId),
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
export const lineup: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await lineups.get(
        matchId(req.params),
        teamMatchSideSchema.parse(req.params.side),
        userId(res.locals),
      ),
    });
  } catch (error) {
    next(error);
  }
};
export const inviteSelection: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await lineups.invite(
        matchId(req.params),
        teamMatchSideSchema.parse(req.params.side),
        String(req.params.userId),
        userId(res.locals),
      ),
    });
  } catch (error) {
    next(error);
  }
};
export const assignLineupStarter: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await lineups.assignStarter(
        matchId(req.params),
        teamMatchSideSchema.parse(req.params.side),
        String(req.params.slotId),
        assignTeamMatchStarterSchema.parse(req.body),
        userId(res.locals),
      ),
    });
  } catch (error) {
    next(error);
  }
};
export const removeLineupStarter: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await lineups.removeStarter(
        matchId(req.params),
        teamMatchSideSchema.parse(req.params.side),
        String(req.params.slotId),
        removeTeamMatchStarterSchema.parse(req.body).playerAction,
        userId(res.locals),
      ),
    });
  } catch (error) {
    next(error);
  }
};
export const openLineupSlot: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await lineups.openSlot(
        matchId(req.params),
        teamMatchSideSchema.parse(req.params.side),
        String(req.params.slotId),
        openTeamMatchLineupSlotSchema.parse(req.body ?? {}),
        userId(res.locals),
      ),
    });
  } catch (error) {
    next(error);
  }
};
export const claimLineupSlot: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await lineups.claim(
        matchId(req.params),
        teamMatchSideSchema.parse(req.params.side),
        String(req.params.slotId),
        userId(res.locals),
      ),
    });
  } catch (error) {
    next(error);
  }
};
export const moveLineupSlot: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await lineups.moveSlot(
        matchId(req.params),
        teamMatchSideSchema.parse(req.params.side),
        String(req.params.slotId),
        updateTeamMatchLineupSlotPositionSchema.parse(req.body),
        userId(res.locals),
      ),
    });
  } catch (error) {
    next(error);
  }
};
export const selectLineupSubstitute: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await lineups.selectSubstitute(
        matchId(req.params),
        teamMatchSideSchema.parse(req.params.side),
        String(req.params.userId),
        userId(res.locals),
      ),
    });
  } catch (error) {
    next(error);
  }
};
export const removeLineupSubstitute: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await lineups.removeSubstitute(
        matchId(req.params),
        teamMatchSideSchema.parse(req.params.side),
        String(req.params.userId),
        userId(res.locals),
      ),
    });
  } catch (error) {
    next(error);
  }
};
export const declineLineupSelection: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await lineups.decline(
        matchId(req.params),
        teamMatchSideSchema.parse(req.params.side),
        userId(res.locals),
      ),
    });
  } catch (error) {
    next(error);
  }
};
export const finalizeLineup: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await lineups.finalize(
        matchId(req.params),
        teamMatchSideSchema.parse(req.params.side),
        userId(res.locals),
      ),
    });
  } catch (error) {
    next(error);
  }
};
export const saveLineupAsTeamDefault: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await lineups.saveAsTeamDefault(
        matchId(req.params),
        teamMatchSideSchema.parse(req.params.side),
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
