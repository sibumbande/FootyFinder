import { changeTeamSubstitutesSchema, fillTeamMeterSchema, loadTeamIntoMatchSchema, teamSideRouteParamSchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { TeamMatchesService } from './team-matches.service.js';
import { TeamMatchMetersService } from './team-match-meters.js';

const service = new TeamMatchesService();
const meters = new TeamMatchMetersService();
const side = (params: Record<string, unknown>) => teamSideRouteParamSchema.parse(params.side);
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

/** DEC-019: a team's own fill meter ("R0 / R1,120"); members of that side only. */
export const meter: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await meters.meter(matchId(req.params), side(req.params), userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};

/** D3: an owner/captain fills their side's meter from the team wallet (a hold). */
export const fillMeter: RequestHandler = async (req, res, next) => {
  try {
    const { amountCents } = fillTeamMeterSchema.parse(req.body ?? {});
    const result = await meters.fill(matchId(req.params), side(req.params), userId(res.locals), amountCents, String(req.header('Idempotency-Key') ?? ''));
    res.status(result.replayed ? 200 : 201).json({ data: result.view });
  } catch (error) {
    next(error);
  }
};

/** D5: an owner/captain changes their side's subs until T-30. */
export const changeSubstitutes: RequestHandler = async (req, res, next) => {
  try {
    const { substituteCount } = changeTeamSubstitutesSchema.parse(req.body);
    const result = await meters.changeSubstitutes(matchId(req.params), side(req.params), userId(res.locals), substituteCount);
    res.json({ data: { ...result.view, releasedCents: result.releasedCents } });
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
