import { describe, expect, it } from 'vitest';
import { settlementWeek, settlementWeekOf } from './settlement-week.js';

describe('settlement week (TKT-608 / D10)', () => {
  it('runs Monday 00:00 to Monday 00:00 in Johannesburg', () => {
    expect(settlementWeek('2026-10-26')).toEqual({
      periodStart: new Date('2026-10-25T22:00:00.000Z'),
      periodEnd: new Date('2026-11-01T22:00:00.000Z'),
    });
  });

  it('rejects days that are not Mondays and malformed input', () => {
    expect(settlementWeek('2026-10-27')).toBeNull();
    expect(settlementWeek('2026-02-30')).toBeNull();
    expect(settlementWeek('26-10-26')).toBeNull();
  });

  it('finds the week of a kickoff, including late Sunday night and early Monday local time', () => {
    expect(settlementWeekOf(new Date('2026-10-30T12:00:00.000Z'))).toBe('2026-10-26');
    // Sunday 23:30 SAST is still the previous week; Monday 00:30 SAST starts the next one.
    expect(settlementWeekOf(new Date('2026-11-01T21:30:00.000Z'))).toBe('2026-10-26');
    expect(settlementWeekOf(new Date('2026-11-01T22:30:00.000Z'))).toBe('2026-11-02');
  });
});
