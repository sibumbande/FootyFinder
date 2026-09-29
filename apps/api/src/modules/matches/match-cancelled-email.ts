import type { Prisma } from '../../generated/prisma/client.js';
import { enqueueDurableJob } from '../../jobs/durable-jobs.js';

export const MATCH_CANCELLED_EMAIL_JOB_TYPE = 'MATCH_CANCELLED_EMAIL';
export const matchCancelledEmailDedupeKey = (matchId: string, userId: string) =>
  `match-cancelled-email:${matchId}:${userId}`;

/**
 * Queue the cancellation email in the cancelling transaction. The job becomes visible only when
 * that transaction commits (so the email is sent after commit), and the dedupe key makes a second
 * enqueue for the same match and user a no-op, so each recipient gets the email once.
 */
export const enqueueMatchCancelledEmail = (
  tx: Prisma.TransactionClient,
  input: { matchId: string; userId: string; refundedCents: number; teamMember?: boolean },
) =>
  enqueueDurableJob(tx, {
    type: MATCH_CANCELLED_EMAIL_JOB_TYPE,
    dedupeKey: matchCancelledEmailDedupeKey(input.matchId, input.userId),
    payload: input,
    runAt: new Date(),
  });
