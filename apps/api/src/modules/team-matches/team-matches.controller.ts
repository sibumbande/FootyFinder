import { loadTeamIntoMatchSchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { TeamMatchesService } from './team-matches.service.js';

const service = new TeamMatchesService();
const userId = (locals: Record<string, unknown>) => String(locals.authUserId);
const matchId = (params: Record<string, unknown>) => String(params.id);

/** Gate 7 / DEC-019 decision C: "Load my team" into the other side of a team match. */
export const loadTeam: RequestHandler = async (req, res, next) => {
  try {
    res.status(201).json({
      data: await service.loadTeam(matchId(req.params), userId(res.locals), loadTeamIntoMatchSchema.parse(req.body)),
    });
  } catch (error) {
    next(error);
  }
};

/** N5: the team that took the other side withdraws only itself, before T-30. */
export const withdrawTeam: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.withdrawTeam(matchId(req.params), userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
