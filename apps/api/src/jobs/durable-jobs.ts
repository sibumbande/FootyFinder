import type { Prisma } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../database/prisma.js';
import { logError, logInfo } from '../observability/logger.js';

export type DurableJobHandler = (payload: Prisma.JsonValue) => Promise<void>;
const handlers = new Map<string, DurableJobHandler>();
export const durableJobBackoffMs = (attempt: number) => Math.min(60 * 60_000, 2 ** Math.max(0, attempt - 1) * 5_000);
export const registerDurableJobHandler = (type: string, handler: DurableJobHandler) => {
  if (handlers.has(type)) throw new Error(`Durable job handler already registered: ${type}`);
  handlers.set(type, handler);
};
export const enqueueDurableJob = (
  tx: Prisma.TransactionClient,
  input: { type: string; dedupeKey: string; payload: Prisma.InputJsonValue; runAt: Date; maxAttempts?: number },
) => tx.durableJob.upsert({
  where: { dedupeKey: input.dedupeKey },
  create: input,
  update: {},
});

export async function runOneDurableJob(now = new Date()) {
  const staleBefore = new Date(now.getTime() - env.DURABLE_JOB_LOCK_TIMEOUT_SECONDS * 1000);
  const jobs = await prisma.$queryRaw<Array<{ id: string; type: string; payload: Prisma.JsonValue; attempts: number; maxAttempts: number }>>`
    WITH candidate AS (
      SELECT "id" FROM "DurableJob"
      WHERE (("status" = 'PENDING' AND "runAt" <= ${now})
        OR ("status" = 'RUNNING' AND "lockedAt" < ${staleBefore}))
        AND "attempts" < "maxAttempts"
      ORDER BY "runAt", "createdAt"
      FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE "DurableJob" job
      SET "status" = 'RUNNING', "lockedAt" = ${now}, "attempts" = job."attempts" + 1,
          "updatedAt" = ${now}
      FROM candidate WHERE job."id" = candidate."id"
      RETURNING job."id", job."type", job."payload", job."attempts", job."maxAttempts"
  `;
  const job = jobs[0];
  if (!job) return false;
  const handler = handlers.get(job.type);
  try {
    if (!handler) throw Object.assign(new Error('No durable job handler is registered.'), { code: 'JOB_HANDLER_MISSING' });
    await handler(job.payload);
    await prisma.durableJob.update({ where: { id: job.id }, data: { status: 'SUCCEEDED', completedAt: new Date(), lockedAt: null, lastError: null } });
    logInfo('durable_job_succeeded', { jobId: job.id, jobType: job.type, attempt: job.attempts });
  } catch (error) {
    const terminal = job.attempts >= job.maxAttempts;
    const errorCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : error instanceof Error ? error.name : 'UNKNOWN';
    await prisma.durableJob.update({ where: { id: job.id }, data: {
      status: terminal ? 'FAILED' : 'PENDING', lockedAt: null, lastError: errorCode.slice(0, 200),
      runAt: terminal ? now : new Date(now.getTime() + durableJobBackoffMs(job.attempts)),
    } });
    logError('durable_job_failed', error, { jobId: job.id, jobType: job.type, attempt: job.attempts, terminal });
  }
  return true;
}

export function startDurableJobScheduler() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (let count = 0; count < 20 && await runOneDurableJob(); count += 1) { /* bounded drain */ }
    } catch (error) { logError('durable_job_scheduler_failed', error); }
    finally { running = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(), env.DURABLE_JOB_POLL_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
