import { describe, expect, it } from 'vitest';
import { nextRetentionRunAt } from './retention.jobs.js';
import { auditRetentionCutoff, financialRetentionCutoff, threeYearsBefore, twelveMonthsBefore } from './retention.policy.js';

// CEO batch 5, item 4: the retention table in ToS clause 8.
describe('retention periods', () => {
  it('chats, requests and closed accounts: 12 months; conduct records: 3 years', () => {
    const now = new Date('2027-10-02T10:00:00Z');
    expect(twelveMonthsBefore(now).toISOString()).toBe('2026-10-02T10:00:00.000Z');
    expect(threeYearsBefore(now).toISOString()).toBe('2024-10-02T10:00:00.000Z');
  });

  it('financial records: 5 years from the end of the tax year (last day of February)', () => {
    // 2 Oct 2031: the tax year that ended 28 Feb 2026 is past 5 years (since 28 Feb 2031); March 2026 onwards is kept.
    expect(financialRetentionCutoff(new Date('2031-10-02T10:00:00Z')).toISOString()).toBe('2026-02-28T22:00:00.000Z');
    // 15 Feb 2031: the tax year ending 28 Feb 2026 still has two weeks to go; only up to Feb 2025 is past 5 years.
    expect(financialRetentionCutoff(new Date('2031-02-15T10:00:00Z')).toISOString()).toBe('2025-02-28T22:00:00.000Z');
    // 1 Mar 2031 00:30 Johannesburg is already the next day after 28 Feb 2031.
    expect(financialRetentionCutoff(new Date('2031-02-28T22:30:00Z')).toISOString()).toBe('2026-02-28T22:00:00.000Z');
    // Today nothing qualifies (the ledger starts in 2026).
    expect(financialRetentionCutoff(new Date('2026-10-02T10:00:00Z')).getUTCFullYear()).toBe(2021);
  });

  it('audit and security records: 5 years after the event (plus one day of margin for the database clock)', () => {
    expect(auditRetentionCutoff(new Date('2031-10-02T10:00:00Z')).toISOString()).toBe('2026-10-01T10:00:00.000Z');
  });

  it('the daily run is at 02:00 Johannesburg', () => {
    expect(nextRetentionRunAt(new Date('2026-10-02T10:00:00Z')).toISOString()).toBe('2026-10-03T00:00:00.000Z');
    expect(nextRetentionRunAt(new Date('2026-10-02T23:30:00Z')).toISOString()).toBe('2026-10-03T00:00:00.000Z');
    expect(nextRetentionRunAt(new Date('2026-10-03T00:00:00Z')).toISOString()).toBe('2026-10-04T00:00:00.000Z');
  });
});
