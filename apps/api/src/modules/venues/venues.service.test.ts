import { describe, expect, it } from 'vitest';
import { zonedLocalToUtc } from './venues.service.js';

describe('zonedLocalToUtc', () => {
  it('converts Johannesburg local slots without applying a browser timezone', () => {
    expect(zonedLocalToUtc('2026-09-28', 18 * 60, 'Africa/Johannesburg')?.toISOString()).toBe(
      '2026-09-28T16:00:00.000Z',
    );
  });

  it('uses the correct offset on both sides of a DST transition', () => {
    expect(zonedLocalToUtc('2026-03-07', 12 * 60, 'America/New_York')?.toISOString()).toBe(
      '2026-03-07T17:00:00.000Z',
    );
    expect(zonedLocalToUtc('2026-03-09', 12 * 60, 'America/New_York')?.toISOString()).toBe(
      '2026-03-09T16:00:00.000Z',
    );
  });

  it('rejects a local wall-clock time skipped by daylight saving', () => {
    expect(zonedLocalToUtc('2026-03-08', 2 * 60 + 30, 'America/New_York')).toBeNull();
  });
});
