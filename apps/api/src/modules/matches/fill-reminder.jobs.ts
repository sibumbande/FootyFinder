import { registerDurableJobHandler } from '../../jobs/durable-jobs.js';
import { FILL_REMINDER_JOB_TYPE } from './fill-reminder.js';
import { MatchesService } from './matches.service.js';

/** TKT-319: the "not full yet" reminder 2 hours before kickoff. Idempotent through notification dedupe keys. */
export const registerFillReminderJobHandlers = (service = new MatchesService()) => {
  registerDurableJobHandler(FILL_REMINDER_JOB_TYPE, async (payload) => {
    const matchId =
      payload && typeof payload === 'object' && !Array.isArray(payload) ? payload.matchId : undefined;
    if (typeof matchId !== 'string')
      throw Object.assign(new Error('Invalid fill reminder payload.'), { code: 'JOB_PAYLOAD_INVALID' });
    await service.sendFillReminder(matchId);
  });
};
