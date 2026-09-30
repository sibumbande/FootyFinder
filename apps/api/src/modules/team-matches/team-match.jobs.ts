import { registerDurableJobHandler } from '../../jobs/durable-jobs.js';
import { createEmailProvider, type EmailProvider } from '../auth/email.provider.js';
import {
  TEAM_MATCH_EMAIL_JOB_TYPE,
  TEAM_MATCH_NO_OPPONENT_WARNING_JOB_TYPE,
  TEAM_MATCH_UNMATCHED_CANCEL_JOB_TYPE,
} from './team-match-jobs.js';
import { TeamMatchesService } from './team-matches.service.js';
import {
  TEAM_MATCH_GO_NO_GO_JOB_TYPE,
  TEAM_METER_REMINDER_JOB_TYPE,
  TeamGoNoGoNotDueError,
  TeamMatchMetersService,
} from './team-match-meters.js';

const matchIdOf = (payload: unknown) => {
  const matchId = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).matchId : undefined;
  if (typeof matchId !== 'string')
    throw Object.assign(new Error('Invalid team-match job payload.'), { code: 'JOB_PAYLOAD_INVALID' });
  return matchId;
};

/** Gate 7 / TKT-706: "Teams only" unmatched cancel and warning, and operational team-match emails. */
export const registerTeamMatchJobHandlers = (
  service = new TeamMatchesService(),
  emails: EmailProvider = createEmailProvider(),
  meters = new TeamMatchMetersService(),
) => {
  // DEC-019 / D1: the team T-30 go/no-go. An early run fails with GO_NO_GO_NOT_DUE and is retried.
  registerDurableJobHandler(TEAM_MATCH_GO_NO_GO_JOB_TYPE, async (payload) => {
    try {
      await meters.decideGoNoGo(matchIdOf(payload));
    } catch (error) {
      if (error instanceof TeamGoNoGoNotDueError)
        throw Object.assign(new Error('The team go/no-go check is not due yet.'), { code: 'GO_NO_GO_NOT_DUE' });
      throw error;
    }
  });
  registerDurableJobHandler(TEAM_METER_REMINDER_JOB_TYPE, async (payload) => {
    await meters.remindUnfilledMeters(matchIdOf(payload));
  });
  registerDurableJobHandler(TEAM_MATCH_UNMATCHED_CANCEL_JOB_TYPE, async (payload) => {
    await service.cancelUnmatched(matchIdOf(payload));
  });
  registerDurableJobHandler(TEAM_MATCH_NO_OPPONENT_WARNING_JOB_TYPE, async (payload) => {
    await service.warnNoOpponent(matchIdOf(payload));
  });
  registerDurableJobHandler(TEAM_MATCH_EMAIL_JOB_TYPE, (payload) => service.sendEmail(payload, emails));
};
