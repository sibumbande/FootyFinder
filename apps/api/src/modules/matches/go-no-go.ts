import { getGoNoGoAt } from '@footy-finder/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { enqueueDurableJob } from '../../jobs/durable-jobs.js';

export const GO_NO_GO_JOB_TYPE = 'QUICK_MATCH_GO_NO_GO';
export const goNoGoJobDedupeKey = (matchId: string) => `quick-match-go-no-go:${matchId}`;

/**
 * DEC-018: schedule the T-30 go/no-go check in the same transaction that creates the match, so a
 * match can never exist without its check. The dedupe key makes re-enqueueing a no-op.
 */
export const enqueueGoNoGoJob = (tx: Prisma.TransactionClient, matchId: string, startsAt: Date) =>
  enqueueDurableJob(tx, {
    type: GO_NO_GO_JOB_TYPE,
    dedupeKey: goNoGoJobDedupeKey(matchId),
    payload: { matchId },
    runAt: getGoNoGoAt(startsAt),
  });
