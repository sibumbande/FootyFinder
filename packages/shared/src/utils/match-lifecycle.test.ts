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

  it('keeps Team planning drafts in DRAFT even after their provisional kickoff', () => {
    expect(
      getEffectiveMatchStatus(
        { status: 'DRAFT', startsAt: kickoff, durationMinutes: 90 },
        new Date('2026-01-03T12:00:00.000Z'),
      ),
    ).toBe('DRAFT');
  });

  it.each([
    ['more than twelve hours', '2026-01-01T23:59:59.999Z', 10_001],
    ['exactly twelve hours', '2026-01-02T00:00:00.000Z', 0],
    ['less than twelve hours', '2026-01-02T00:00:00.001Z', 0],
    ['at kickoff', '2026-01-02T12:00:00.000Z', null],
    ['after kickoff', '2026-01-02T12:00:00.001Z', null],
  ])('calculates cancellation credit %s', (_case, now, expected) => {
    expect(getCancellationCreditCents(10_001, kickoff, new Date(now))).toBe(expected);
  });
});
