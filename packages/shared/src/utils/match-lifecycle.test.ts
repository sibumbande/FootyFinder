import { describe, expect, it } from 'vitest';
import { getCancellationCreditCents, getEffectiveMatchStatus } from './match-lifecycle.js';

const kickoff = new Date('2026-01-02T12:00:00.000Z');

describe('match lifecycle', () => {
  it('uses the configured duration to derive in-progress and awaiting-result states', () => {
    const match = { status: 'OPEN' as const, startsAt: kickoff, durationMinutes: 90 };
    expect(getEffectiveMatchStatus(match, new Date('2026-01-02T12:30:00.000Z'))).toBe(
      'IN_PROGRESS',
    );
    expect(getEffectiveMatchStatus(match, new Date('2026-01-02T13:30:00.000Z'))).toBe(
      'AWAITING_RESULT',
    );
  });

  it.each([
    ['more than eight hours', '2026-01-02T03:59:59.999Z', 10_001],
    ['exactly eight hours', '2026-01-02T04:00:00.000Z', 5_000],
    ['less than eight hours', '2026-01-02T04:00:00.001Z', 5_000],
    ['at kickoff', '2026-01-02T12:00:00.000Z', null],
    ['after kickoff', '2026-01-02T12:00:00.001Z', null],
  ])('calculates cancellation credit %s', (_case, now, expected) => {
    expect(getCancellationCreditCents(10_001, kickoff, new Date(now))).toBe(expected);
  });
});
