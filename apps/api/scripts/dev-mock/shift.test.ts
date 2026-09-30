import { describe, expect, it } from 'vitest';
import { kickoffRelativeRunAt } from './shift.js';

const kickoff = new Date('2026-10-01T16:00:00.000Z');
const now = new Date('2026-10-01T10:00:00.000Z');
const at = (type: string, key = `x:m1`) => kickoffRelativeRunAt(type, key, kickoff, now)?.toISOString() ?? null;

describe('dev shift: kickoff-relative job times', () => {
  it('uses the app timing for every kickoff-relative job', () => {
    expect(at('QUICK_MATCH_GO_NO_GO')).toBe('2026-10-01T15:30:00.000Z');
    expect(at('TEAM_MATCH_GO_NO_GO')).toBe('2026-10-01T15:30:00.000Z');
    expect(at('QUICK_MATCH_FILL_REMINDER')).toBe('2026-10-01T14:00:00.000Z');
    expect(at('TEAM_METER_REMINDER')).toBe('2026-10-01T14:00:00.000Z');
    expect(at('TEAM_MATCH_NO_OPPONENT_WARNING')).toBe('2026-09-29T16:00:00.000Z');
    expect(at('TEAM_MATCH_UNMATCHED_CANCEL', 'team-match-unmatched-cancel:m1')).toBe('2026-09-30T16:00:00.000Z');
    expect(at('REFEREE_UNASSIGNED_ALERT', 'referee-unassigned-alert:m1:t-24h')).toBe('2026-09-30T16:00:00.000Z');
  });

  it('keeps a post-withdrawal unmatched cancel no earlier than now, like the app', () => {
    expect(at('TEAM_MATCH_UNMATCHED_CANCEL', 'team-match-unmatched-cancel:m1:w1')).toBe(now.toISOString());
  });

  it('never moves jobs that are not tied to kickoff', () => {
    expect(at('REFEREE_UNASSIGNED_ALERT', 'referee-unassigned-alert:m1:published')).toBeNull();
    expect(at('MATCH_CANCELLED_EMAIL')).toBeNull();
    expect(at('REFEREE_RESULT_OVERDUE')).toBeNull();
    expect(at('TEAM_MATCH_EMAIL')).toBeNull();
  });
});
