import { changeTeamSubstitutesSchema, loadTeamIntoMatchSchema, teamSideRouteParamSchema, teamTicketCheckoutSchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { TeamMatchesService } from './team-matches.service.js';
import { TeamMatchMetersService } from './team-match-meters.js';
import { TeamTicketsService } from '../tickets/team-tickets.service.js';

const service = new TeamMatchesService();
const meters = new TeamMatchMetersService();
const teamTickets = new TeamTicketsService();
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

/** Retired with the team wallet (DEC-021): 410 TEAM_METER_RETIRED. */
export const meter: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await meters.meter(matchId(req.params), side(req.params), userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};

/** Retired with the team wallet (DEC-021): 410 TEAM_METER_RETIRED. */
export const fillMeter: RequestHandler = async (_req, _res, next) => {
  try {
    await meters.fill();
  } catch (error) {
    next(error);
  }
};

/** DEC-021 A5: a team's named payment checklist ("11 of 14 paid · R240 still needed"); members of that team only. */
export const paymentRoster: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await teamTickets.roster(matchId(req.params), side(req.params), userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};

/** DEC-021 A5: a squad member pays for named teammates (Idempotency-Key). */
export const payForTeammates: RequestHandler = async (req, res, next) => {
  try {
    const result = await teamTickets.checkout(
      matchId(req.params),
      side(req.params),
      userId(res.locals),
      teamTicketCheckoutSchema.parse(req.body),
      String(req.header('Idempotency-Key') ?? ''),
      { ip: req.ip, userAgent: req.get('User-Agent') ?? undefined },
    );
    res.status(result.state === 'CONFIRMED' ? 201 : 202).json({ data: result });
  } catch (error) {
    next(error);
  }
};

/** D5 (DEC-021 D1): an owner/captain changes their side's subs until the T-2h payment cutoff. */
export const changeSubstitutes: RequestHandler = async (req, res, next) => {
  try {
    const { substituteCount } = changeTeamSubstitutesSchema.parse(req.body);
    res.json({ data: await meters.changeSubstitutes(matchId(req.params), side(req.params), userId(res.locals), substituteCount) });
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
