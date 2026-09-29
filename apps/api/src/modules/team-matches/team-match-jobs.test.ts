import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  enqueueTeamMatchSideJobs,
  enqueueUnmatchedCancelAfterWithdrawal,
  teamMatchMessage,
  TEAM_MATCH_NO_OPPONENT_WARNING_JOB_TYPE,
  TEAM_MATCH_UNMATCHED_CANCEL_JOB_TYPE,
} from './team-match-jobs.js';

const txWith = () => {
  const upsert = vi.fn(async (args: { create: unknown }) => args.create);
  return { tx: { durableJob: { upsert } } as unknown as Prisma.TransactionClient, upsert };
};
// Kickoff Fri 30 Oct 2026 14:00 SAST.
const startsAt = new Date('2026-10-30T12:00:00.000Z');
const jobs = (upsert: ReturnType<typeof txWith>['upsert']) =>
  upsert.mock.calls.map(([args]) => args.create as { type: string; runAt: Date });

describe('team-match side jobs (Gate 7 / TKT-706)', () => {
  it('schedules the 48h warning and the 24h unmatched cancel for a "Teams only" match published early', () => {
    const { tx, upsert } = txWith();
    return enqueueTeamMatchSideJobs(tx, { id: 'm1', startsAt, otherSideMode: 'TEAMS_ONLY' }, new Date('2026-10-25T12:00:00.000Z')).then(() => {
      expect(jobs(upsert)).toEqual([
        expect.objectContaining({ type: TEAM_MATCH_UNMATCHED_CANCEL_JOB_TYPE, runAt: new Date('2026-10-29T12:00:00.000Z') }),
        expect.objectContaining({ type: TEAM_MATCH_NO_OPPONENT_WARNING_JOB_TYPE, runAt: new Date('2026-10-28T12:00:00.000Z') }),
      ]);
    });
  });

  it('leaves a "Teams only" match published less than 24h ahead to the T-30 check', async () => {
    const { tx, upsert } = txWith();
    await enqueueTeamMatchSideJobs(tx, { id: 'm1', startsAt, otherSideMode: 'TEAMS_ONLY' }, new Date('2026-10-29T20:00:00.000Z'));
    expect(upsert).not.toHaveBeenCalled();
  });

  it('gives an "Open to both" match the kickoff-2h fill reminder instead', async () => {
    const { tx, upsert } = txWith();
    await enqueueTeamMatchSideJobs(tx, { id: 'm1', startsAt, otherSideMode: 'OPEN' }, new Date('2026-10-25T12:00:00.000Z'));
    expect(jobs(upsert)).toEqual([expect.objectContaining({ type: 'QUICK_MATCH_FILL_REMINDER', runAt: new Date('2026-10-30T10:00:00.000Z') })]);
  });

  it('re-runs the unmatched check straight away after a late withdrawal (N5)', async () => {
    const { tx, upsert } = txWith();
    const now = new Date('2026-10-30T02:00:00.000Z');
    await enqueueUnmatchedCancelAfterWithdrawal(tx, { id: 'm1', startsAt }, 'w1', now);
    expect(jobs(upsert)[0]).toMatchObject({ type: TEAM_MATCH_UNMATCHED_CANCEL_JOB_TYPE, runAt: now });
    expect(upsert.mock.calls[0]![0]).toMatchObject({ where: { dedupeKey: 'team-match-unmatched-cancel:m1:w1' } });
  });

  it('words the warning with the cancel time', () => {
    expect(teamMatchMessage('NO_OPPONENT_WARNING', { name: 'Derby', startsAt, venueName: 'Queens Park' }))
      .toBe('No team has taken the other side of Derby (Fri 30 Oct 2026 at 14:00) yet. If nobody takes it by Thu 29 Oct 2026 at 14:00, the match is cancelled. Share the match link with other teams.');
  });
});
