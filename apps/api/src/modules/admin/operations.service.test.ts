import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyGoNoGoJob } from './go-no-go-health.js';

const now = new Date('2026-10-30T11:40:00.000Z');
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

const db = vi.hoisted(() => ({
  jobs: [] as Array<Record<string, unknown>>,
  counts: [0, 0, 0] as number[],
  undecidedCount: 0,
  undecided: [] as Array<{ id: string; name: string; startsAt: Date }>,
  matches: [] as Array<{ id: string; name: string; startsAt: Date }>,
}));

vi.mock('../../database/prisma.js', () => ({
  prisma: {
    durableJob: {
      findMany: vi.fn(async () => db.jobs),
      count: vi.fn(async ({ where }: { where: { status: string } }) =>
        where.status === 'PENDING' ? db.counts[0] : where.status === 'RUNNING' ? db.counts[1] : db.counts[2],
      ),
    },
    match: {
      count: vi.fn(async () => db.undecidedCount),
      findMany: vi.fn(async ({ where }: { where: { id?: unknown } }) => (where.id ? db.matches : db.undecided)),
    },
  },
}));

const { OperationsService } = await import('./operations.service.js');

describe('classifyGoNoGoJob', () => {
  it('flags failed, overdue and stale-running checks and leaves on-time ones alone', () => {
    expect(classifyGoNoGoJob({ status: 'FAILED', runAt: minutesAgo(1), lockedAt: null }, now, 300)).toBe('FAILED');
    expect(classifyGoNoGoJob({ status: 'PENDING', runAt: minutesAgo(2), lockedAt: null }, now, 300)).toBe('OVERDUE');
    expect(classifyGoNoGoJob({ status: 'PENDING', runAt: new Date(now.getTime() - 30_000), lockedAt: null }, now, 300)).toBeNull();
    expect(classifyGoNoGoJob({ status: 'PENDING', runAt: new Date(now.getTime() + 60_000), lockedAt: null }, now, 300)).toBeNull();
    expect(classifyGoNoGoJob({ status: 'RUNNING', runAt: minutesAgo(10), lockedAt: minutesAgo(6) }, now, 300)).toBe('STALE_RUNNING');
    expect(classifyGoNoGoJob({ status: 'RUNNING', runAt: minutesAgo(10), lockedAt: minutesAgo(1) }, now, 300)).toBeNull();
    expect(classifyGoNoGoJob({ status: 'SUCCEEDED', runAt: minutesAgo(10), lockedAt: null }, now, 300)).toBeNull();
  });
});

describe('OperationsService.goNoGoHealth', () => {
  beforeEach(() => {
    db.jobs = [];
    db.counts = [0, 0, 0];
    db.undecidedCount = 0;
    db.undecided = [];
    db.matches = [];
  });

  it('reports nothing when every check is on time', async () => {
    expect(await new OperationsService().goNoGoHealth(now)).toEqual({
      overdue: 0,
      staleRunning: 0,
      failed: 0,
      unconfirmedPastKickoff: 0,
      items: [],
    });
  });

  it('lists overdue and failed checks with their match, and undecided matches past kickoff', async () => {
    const kickoff = new Date('2026-10-30T12:00:00.000Z');
    db.jobs = [
      { id: 'job-overdue', status: 'PENDING', runAt: minutesAgo(10), lockedAt: null, attempts: 0, lastError: null, payload: { matchId: 'm-1' } },
      { id: 'job-failed', status: 'FAILED', runAt: minutesAgo(5), lockedAt: null, attempts: 10, lastError: 'P2034', payload: { matchId: 'm-2' } },
    ];
    db.counts = [1, 0, 1];
    db.matches = [
      { id: 'm-1', name: 'Friday five', startsAt: kickoff },
      { id: 'm-2', name: 'Saturday seven', startsAt: kickoff },
    ];
    db.undecidedCount = 1;
    db.undecided = [{ id: 'm-3', name: 'Missed check', startsAt: minutesAgo(5) }];

    const health = await new OperationsService().goNoGoHealth(now);
    expect(health).toMatchObject({ overdue: 1, failed: 1, staleRunning: 0, unconfirmedPastKickoff: 1 });
    expect(health.items).toEqual([
      expect.objectContaining({ jobId: 'job-overdue', matchId: 'm-1', matchName: 'Friday five', problem: 'OVERDUE', startsAt: kickoff.toISOString() }),
      expect.objectContaining({ jobId: 'job-failed', matchId: 'm-2', problem: 'FAILED', attempts: 10, lastError: 'P2034' }),
      expect.objectContaining({ jobId: null, matchId: 'm-3', matchName: 'Missed check', problem: 'UNCONFIRMED_PAST_KICKOFF' }),
    ]);
  });
});
