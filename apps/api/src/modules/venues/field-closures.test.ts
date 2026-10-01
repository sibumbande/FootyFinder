import { describe, expect, it } from 'vitest';
import { overlapsClosure, type FieldClosureRow } from './field-closures.js';

const TZ = 'Africa/Johannesburg';
const weekly = (overrides: Partial<FieldClosureRow> = {}): FieldClosureRow => ({
  kind: 'WEEKLY', startsAt: null, endsAt: null, dayOfWeek: 1, startMinute: 18 * 60, endMinute: 20 * 60,
  startsOn: new Date('2026-10-01T00:00:00Z'), endsOn: null, ...overrides,
});
// Monday 12 October 2026, local (UTC+2) times.
const at = (localTime: string, minutes = 60) => {
  const start = new Date(`2026-10-12T${localTime}:00+02:00`);
  return [start, new Date(start.getTime() + minutes * 60_000)] as const;
};

describe('field closures (CEO batch 3, item 3)', () => {
  it('closes the weekly window in the venue timezone, and only that window', () => {
    expect(overlapsClosure([weekly()], ...at('18:00'), TZ)).toBe(true);
    expect(overlapsClosure([weekly()], ...at('17:30'), TZ)).toBe(true);
    expect(overlapsClosure([weekly()], ...at('19:30'), TZ)).toBe(true);
    expect(overlapsClosure([weekly()], ...at('17:00'), TZ)).toBe(false);
    expect(overlapsClosure([weekly()], ...at('20:00'), TZ)).toBe(false);
  });

  it('applies only on its weekday and between its start and optional end dates', () => {
    expect(overlapsClosure([weekly({ dayOfWeek: 2 })], ...at('18:00'), TZ)).toBe(false);
    expect(overlapsClosure([weekly({ startsOn: new Date('2026-10-13T00:00:00Z') })], ...at('18:00'), TZ)).toBe(false);
    expect(overlapsClosure([weekly({ endsOn: new Date('2026-10-11T00:00:00Z') })], ...at('18:00'), TZ)).toBe(false);
    expect(overlapsClosure([weekly({ endsOn: new Date('2026-10-12T00:00:00Z') })], ...at('18:00'), TZ)).toBe(true);
  });

  it('closes a one-off time range', () => {
    const oneOff: FieldClosureRow = { kind: 'ONE_OFF', startsAt: new Date('2026-10-12T08:00:00Z'), endsAt: new Date('2026-10-12T10:00:00Z'), dayOfWeek: null, startMinute: null, endMinute: null, startsOn: null, endsOn: null };
    expect(overlapsClosure([oneOff], ...at('11:00'), TZ)).toBe(true);
    expect(overlapsClosure([oneOff], ...at('12:00'), TZ)).toBe(false);
  });

  it('handles a slot that runs past midnight into the closed day', () => {
    const sundayLate = new Date('2026-10-11T23:30:00+02:00');
    expect(overlapsClosure([weekly({ startMinute: 0, endMinute: 60 })], sundayLate, new Date(sundayLate.getTime() + 60 * 60_000), TZ)).toBe(true);
  });
});
