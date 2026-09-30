import { describe, expect, it } from 'vitest';
import { refereeResultSchema, validateMatchResult } from './match-result.js';

const A1 = '00000000-0000-4000-8000-000000000001';
const A2 = '00000000-0000-4000-8000-000000000002';
const B1 = '00000000-0000-4000-8000-000000000003';
const OUTSIDER = '00000000-0000-4000-8000-000000000009';
const lineup = [
  { userId: A1, side: 'HOME' as const },
  { userId: A2, side: 'HOME' as const },
  { userId: B1, side: 'AWAY' as const },
];
const played = (goals: Parameters<typeof validateMatchResult>[0]['goals'], homeScore: number, awayScore: number, didNotPlayUserIds: string[] = []) =>
  validateMatchResult({ outcome: 'PLAYED', homeScore, awayScore, goals, didNotPlayUserIds }, lineup);

describe('referee result validation (Gate 8 / TKT-804)', () => {
  it('accepts goals that add up, with assists and own goals (D7)', () => {
    expect(played([
      { side: 'HOME', scorerUserId: A1, assistUserId: A2 },
      { side: 'HOME', ownGoal: true },
      { side: 'AWAY', scorerUserId: B1 },
    ], 2, 1)).toEqual([]);
  });

  it('rejects goals that do not match the score', () => {
    expect(played([{ side: 'HOME', scorerUserId: A1 }], 2, 0)).toContain('GOAL_COUNT_MISMATCH');
  });

  it('keeps scorers and assisters to the scoring side of the kickoff lineup', () => {
    expect(played([{ side: 'HOME', scorerUserId: B1 }], 1, 0)).toContain('SCORER_NOT_IN_LINEUP');
    expect(played([{ side: 'HOME', scorerUserId: OUTSIDER }], 1, 0)).toContain('SCORER_NOT_IN_LINEUP');
    expect(played([{ side: 'HOME', scorerUserId: A1, assistUserId: B1 }], 1, 0)).toContain('ASSIST_NOT_IN_LINEUP');
    expect(played([{ side: 'HOME', scorerUserId: A1, assistUserId: A1 }], 1, 0)).toContain('ASSIST_IS_SCORER');
    expect(played([{ side: 'HOME' }], 1, 0)).toContain('SCORER_REQUIRED');
  });

  it('an own goal names nobody', () => {
    expect(played([{ side: 'AWAY', ownGoal: true, scorerUserId: A1 }], 0, 1)).toContain('OWN_GOAL_NAMES_NOBODY');
  });

  it('players marked as not playing cannot score or assist, and must be in the lineup (D14)', () => {
    expect(played([{ side: 'HOME', scorerUserId: A1 }], 1, 0, [A1])).toContain('PLAYER_DID_NOT_PLAY');
    expect(played([{ side: 'HOME', scorerUserId: A1, assistUserId: A2 }], 1, 0, [A2])).toContain('PLAYER_DID_NOT_PLAY');
    expect(played([], 0, 0, [OUTSIDER])).toContain('DID_NOT_PLAY_NOT_IN_LINEUP');
  });

  it('a forfeit needs a winner and records 0-0 with no goals; abandoned is 0-0 with no goals (D13)', () => {
    expect(validateMatchResult({ outcome: 'FORFEIT', homeScore: 0, awayScore: 0, forfeitWinner: 'HOME', goals: [], didNotPlayUserIds: [] }, lineup)).toEqual([]);
    expect(validateMatchResult({ outcome: 'FORFEIT', homeScore: 0, awayScore: 0, goals: [], didNotPlayUserIds: [] }, lineup)).toContain('FORFEIT_WINNER_REQUIRED');
    expect(validateMatchResult({ outcome: 'FORFEIT', homeScore: 3, awayScore: 0, forfeitWinner: 'HOME', goals: [], didNotPlayUserIds: [] }, lineup)).toContain('NO_GOALS_ALLOWED');
    expect(validateMatchResult({ outcome: 'ABANDONED', homeScore: 0, awayScore: 0, goals: [], didNotPlayUserIds: [] }, lineup)).toEqual([]);
    expect(validateMatchResult({ outcome: 'ABANDONED', homeScore: 0, awayScore: 0, forfeitWinner: 'AWAY', goals: [], didNotPlayUserIds: [] }, lineup)).toContain('FORFEIT_WINNER_NOT_ALLOWED');
  });

  it('parses the request body with sensible defaults', () => {
    expect(refereeResultSchema.parse({ outcome: 'PLAYED', homeScore: 0, awayScore: 0 })).toEqual({
      outcome: 'PLAYED', homeScore: 0, awayScore: 0, goals: [], didNotPlayUserIds: [],
    });
    expect(refereeResultSchema.safeParse({ outcome: 'WON', homeScore: 0, awayScore: 0 }).success).toBe(false);
  });
});
