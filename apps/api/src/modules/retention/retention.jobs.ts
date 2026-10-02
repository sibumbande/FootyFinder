import { prisma } from '../../database/prisma.js';
import { enqueueDurableJob, registerDurableJobHandler } from '../../jobs/durable-jobs.js';
import { RetentionService } from './retention.service.js';

export const RETENTION_DAILY_JOB = 'RETENTION_DAILY';

/** The next 02:00 in Johannesburg (UTC+2, no daylight saving) after `now`. */
export const nextRetentionRunAt = (now: Date) => {
  const local = new Date(now.getTime() + 2 * 3_600_000);
  const next = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 2) - 2 * 3_600_000;
  return new Date(next > now.getTime() ? next : next + 24 * 3_600_000);
};

const scheduleNext = (now: Date) => {
  const runAt = nextRetentionRunAt(now);
  return prisma.$transaction((tx) =>
    enqueueDurableJob(tx, {
      type: RETENTION_DAILY_JOB,
      dedupeKey: `retention-daily:${runAt.toISOString().slice(0, 10)}`,
      payload: {},
      runAt,
    }),
  );
};

/**
 * CEO batch 5, item 4: the retention table runs every night at 02:00 (Johannesburg). Each run schedules the next,
 * and the server schedules one on start, so a missed night is picked up (the dedupe key is the date).
 */
export const registerRetentionJobHandlers = (service = new RetentionService()) => {
  registerDurableJobHandler(RETENTION_DAILY_JOB, async () => {
    await service.run({ trigger: 'DAILY' });
    await scheduleNext(new Date(Date.now() + 60_000));
  });
};

export const scheduleRetention = () => scheduleNext(new Date());
