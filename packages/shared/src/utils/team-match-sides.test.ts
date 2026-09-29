import { describe, expect, it } from 'vitest';
import { decideOtherSide, effectiveOtherSide } from './team-match-sides.js';

describe('decideOtherSide (DEC-019 B/C/N1)', () => {
  const open = { mode: 'OPEN' as const, takenBy: null, joinedIndividuals: 0 };
  const teamsOnly = { mode: 'TEAMS_ONLY' as const, takenBy: null, joinedIndividuals: 0 };

  it('lets the first team take an open side in either mode', () => {
    expect(decideOtherSide(open, 'TEAM')).toEqual({ allowed: true, next: 'TEAM' });
    expect(decideOtherSide(teamsOnly, 'TEAM')).toEqual({ allowed: true, next: 'TEAM' });
  });

  it('lets individuals join only an "Open to both" side not taken by a team', () => {
    expect(decideOtherSide(open, 'INDIVIDUAL')).toEqual({ allowed: true, next: 'INDIVIDUALS' });
    expect(decideOtherSide({ ...open, takenBy: 'INDIVIDUALS', joinedIndividuals: 4 }, 'INDIVIDUAL')).toEqual({ allowed: true, next: 'INDIVIDUALS' });
    expect(decideOtherSide(teamsOnly, 'INDIVIDUAL')).toEqual({ allowed: false, reason: 'TEAMS_ONLY' });
    expect(decideOtherSide({ ...open, takenBy: 'TEAM' }, 'INDIVIDUAL')).toEqual({ allowed: false, reason: 'TAKEN_BY_TEAM' });
  });

  it('stops a team loading once an individual has joined, and reopens when nobody is left (N1)', () => {
    expect(decideOtherSide({ ...open, takenBy: 'INDIVIDUALS', joinedIndividuals: 1 }, 'TEAM')).toEqual({ allowed: false, reason: 'TAKEN_BY_INDIVIDUALS' });
    expect(decideOtherSide({ ...open, takenBy: 'INDIVIDUALS', joinedIndividuals: 0 }, 'TEAM')).toEqual({ allowed: true, next: 'TEAM' });
    expect(effectiveOtherSide('INDIVIDUALS', 0)).toBeNull();
    expect(effectiveOtherSide('INDIVIDUALS', 2)).toBe('INDIVIDUALS');
  });

  it('never lets a second team take a side', () => {
    expect(decideOtherSide({ ...teamsOnly, takenBy: 'TEAM' }, 'TEAM')).toEqual({ allowed: false, reason: 'TAKEN_BY_TEAM' });
  });
});
