import type { GoNoGoHealthItem, GoNoGoProblem } from '@footy-finder/shared';

/** A PENDING check this long past its runAt is overdue (the scheduler polls every few seconds). */
export const GO_NO_GO_OVERDUE_GRACE_MS = 60_000;

type JobRow = {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  runAt: Date;
  lockedAt: Date | null;
  attempts: number;
  lastError: string | null;
  payload: unknown;
};

/**
 * Why a QUICK_MATCH_GO_NO_GO job needs an admin's attention, or null when it is on time:
 * FAILED (retries exhausted), OVERDUE (still pending past runAt plus a grace period) or
 * STALE_RUNNING (a worker claimed it and stopped, and the lock has not yet been reclaimed).
 */
export const classifyGoNoGoJob = (
  job: Pick<JobRow, 'status' | 'runAt' | 'lockedAt'>,
  now: Date,
  lockTimeoutSeconds: number,
): GoNoGoProblem | null => {
  if (job.status === 'FAILED') return 'FAILED';
  if (job.status === 'PENDING' && job.runAt.getTime() < now.getTime() - GO_NO_GO_OVERDUE_GRACE_MS)
    return 'OVERDUE';
  if (
    job.status === 'RUNNING' &&
    job.lockedAt &&
    job.lockedAt.getTime() < now.getTime() - lockTimeoutSeconds * 1000
  )
    return 'STALE_RUNNING';
  return null;
};

export const goNoGoJobMatchId = (payload: unknown) =>
  payload && typeof payload === 'object' && !Array.isArray(payload) && typeof (payload as { matchId?: unknown }).matchId === 'string'
    ? (payload as { matchId: string }).matchId
    : null;

export const toGoNoGoHealthItem = (
  job: JobRow,
  problem: GoNoGoProblem,
  match: { name: string; startsAt: Date } | undefined,
): GoNoGoHealthItem => ({
  jobId: job.id,
  matchId: goNoGoJobMatchId(job.payload),
  matchName: match?.name ?? null,
  startsAt: match?.startsAt.toISOString() ?? null,
  runAt: job.runAt.toISOString(),
  status: job.status,
  attempts: job.attempts,
  lastError: job.lastError,
  problem,
});
