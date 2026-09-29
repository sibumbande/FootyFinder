import { describe, expect, it } from 'vitest';
import {
  getCancellationCreditCents,
  getEffectiveMatchStatus,
  getGoNoGoAt,
  GO_NO_GO_MINUTES_BEFORE_KICKOFF,
  isLobbyFrozen,
} from './match-lifecycle.js';

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

  it('preserves a derived FULL status until kickoff', () => {
    expect(
      getEffectiveMatchStatus(
        {
          status: 'FULL',
          startsAt: new Date('2026-01-02T13:00:00.000Z'),
          durationMinutes: 60,
        },
        new Date('2026-01-02T12:00:00.000Z'),
      ),
    ).toBe('FULL');
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

describe('DEC-018 go/no-go timing', () => {
  it('checks 30 minutes before kickoff (kickoff 30 Oct 2026 14:00 SAST -> 13:30)', () => {
    const kickoff = new Date('2026-10-30T14:00:00+02:00');
    expect(getGoNoGoAt(kickoff).toISOString()).toBe(new Date('2026-10-30T13:30:00+02:00').toISOString());
    expect(GO_NO_GO_MINUTES_BEFORE_KICKOFF).toBe(30);
  });

  it('freezes the lobby from the go/no-go instant onward, and never freezes legacy matches', () => {
    const goNoGoAt = new Date('2026-10-30T11:30:00.000Z');
    expect(isLobbyFrozen({ goNoGoAt }, new Date('2026-10-30T11:29:59.999Z'))).toBe(false);
    expect(isLobbyFrozen({ goNoGoAt }, new Date('2026-10-30T11:30:00.000Z'))).toBe(true);
    expect(isLobbyFrozen({ goNoGoAt: goNoGoAt.toISOString() }, new Date('2026-10-30T13:00:00.000Z'))).toBe(true);
    expect(isLobbyFrozen({ goNoGoAt: null }, new Date('2099-01-01T00:00:00.000Z'))).toBe(false);
    expect(isLobbyFrozen({}, new Date('2099-01-01T00:00:00.000Z'))).toBe(false);
  });
});
