import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  enqueueFillReminderJob,
  FILL_REMINDER_JOB_TYPE,
  fillReminderMessage,
  openPositionsForReminder,
} from './fill-reminder.js';

// Kickoff 30 Oct 2026 14:00 SAST (12:00Z): reminder at 12:00 SAST, go/no-go at 13:30 SAST.
const startsAt = new Date('2026-10-30T12:00:00.000Z');
const goNoGoAt = new Date('2026-10-30T11:30:00.000Z');
const slots = (filled: number, total: number) =>
  Array.from({ length: total }, (_, index) => ({ participantId: index < filled ? `p${index}` : null }));

const txWithUpsert = () => {
  const upsert = vi.fn(async () => ({}));
  return { tx: { durableJob: { upsert } } as unknown as Prisma.TransactionClient, upsert };
};

describe('fill reminder (TKT-319)', () => {
  it('says how many positions are open and when the match would be cancelled', () => {
    expect(fillReminderMessage(3, startsAt)).toBe(
      "3 positions still open. Share the match link or it'll be cancelled at 13:30.",
    );
    expect(fillReminderMessage(1, startsAt)).toBe(
      "1 position still open. Share the match link or it'll be cancelled at 13:30.",
    );
  });

  it('is scheduled 2 hours before kickoff when the match is created more than 2h30m ahead', async () => {
    const { tx, upsert } = txWithUpsert();
    await enqueueFillReminderJob(tx, 'm1', startsAt, new Date('2026-10-30T09:29:00.000Z'));
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dedupeKey: 'quick-match-fill-reminder:m1' },
        create: expect.objectContaining({
          type: FILL_REMINDER_JOB_TYPE,
          payload: { matchId: 'm1' },
          runAt: new Date('2026-10-30T10:00:00.000Z'),
        }),
      }),
    );
  });

  it('is not scheduled when the match is created 2h30m or less before kickoff', async () => {
    const { tx, upsert } = txWithUpsert();
    expect(await enqueueFillReminderJob(tx, 'm1', startsAt, new Date('2026-10-30T09:30:00.000Z'))).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('only reminds about an open, undecided go/no-go match with open positions', () => {
    const base = { status: 'OPEN', goNoGoAt, confirmedAt: null, formationSlots: slots(7, 10) };
    expect(openPositionsForReminder(base)).toBe(3);
    expect(openPositionsForReminder({ ...base, formationSlots: slots(10, 10) })).toBe(0);
    expect(openPositionsForReminder({ ...base, status: 'CANCELLED' })).toBe(0);
    expect(openPositionsForReminder({ ...base, goNoGoAt: null })).toBe(0);
    expect(openPositionsForReminder({ ...base, confirmedAt: goNoGoAt })).toBe(0);
  });
});
