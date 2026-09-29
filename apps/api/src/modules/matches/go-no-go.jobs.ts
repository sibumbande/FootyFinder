import { registerDurableJobHandler } from '../../jobs/durable-jobs.js';
import { GO_NO_GO_JOB_TYPE } from './go-no-go.js';
import { MatchesService } from './matches.service.js';

/**
 * DEC-018 T-30 go/no-go. Jobs are enqueued in the same transaction that creates the match, run at
 * goNoGoAt through the durable queue (FOR UPDATE SKIP LOCKED claim, retry with backoff, stale-lock
 * recovery after a restart), and the decision itself is idempotent.
 */
export const registerGoNoGoJobHandlers = (service = new MatchesService()) => {
  registerDurableJobHandler(GO_NO_GO_JOB_TYPE, async (payload) => {
    const matchId =
      payload && typeof payload === 'object' && !Array.isArray(payload) ? payload.matchId : undefined;
    if (typeof matchId !== 'string')
      throw Object.assign(new Error('Invalid go/no-go payload.'), { code: 'JOB_PAYLOAD_INVALID' });
    await service.decideGoNoGo(matchId);
  });
};
