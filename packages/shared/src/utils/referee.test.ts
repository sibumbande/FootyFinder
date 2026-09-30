import { describe, expect, it } from 'vitest';
import { getRefereeWindow, refereeWindowsOverlap } from './referee.js';

const at = (time: string, durationMinutes = 60) => ({ startsAt: `2026-10-30T${time}:00.000Z`, durationMinutes });

describe('referee busy windows (Gate 8 / D27)', () => {
  it('runs from kickoff to the scheduled end plus 30 minutes of travel', () => {
    const window = getRefereeWindow(at('12:00'));
    expect(window.start.toISOString()).toBe('2026-10-30T12:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-10-30T13:30:00.000Z');
  });

  it('refuses matches whose windows overlap, including within the travel buffer', () => {
    expect(refereeWindowsOverlap(at('12:00'), at('12:30'))).toBe(true);
    expect(refereeWindowsOverlap(at('12:00'), at('13:00'))).toBe(true);
    expect(refereeWindowsOverlap(at('13:00'), at('12:00'))).toBe(true);
    expect(refereeWindowsOverlap(at('12:00'), at('13:29'))).toBe(true);
  });

  it('allows back-to-back matches once the travel buffer has passed', () => {
    expect(refereeWindowsOverlap(at('12:00'), at('13:30'))).toBe(false);
    expect(refereeWindowsOverlap(at('13:30'), at('12:00'))).toBe(false);
    expect(refereeWindowsOverlap(at('12:00', 90), at('14:00'))).toBe(false);
    expect(refereeWindowsOverlap(at('12:00', 90), at('13:59'))).toBe(true);
  });
});
