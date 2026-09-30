import type { MatchLineupPlayer } from '@footy-finder/shared';
import { describe, expect, it } from 'vitest';
import { describeGoals, draftProblems, emptyResultDraft, toRefereeResultInput } from './result-draft.js';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const lineup: MatchLineupPlayer[] = [
  { userId: A, displayName: 'Ann', side: 'HOME', role: 'STARTER', slotIndex: 0, didNotPlay: false },
  { userId: B, displayName: 'Ben', side: 'HOME', role: 'SUBSTITUTE', slotIndex: null, didNotPlay: false },
  { userId: C, displayName: 'Cara', side: 'AWAY', role: 'STARTER', slotIndex: 0, didNotPlay: false },
];
const sides = { HOME: 'Team A', AWAY: 'Team B' };

describe('referee result draft (Gate 8 / TKT-805)', () => {
  it('derives each score from the goals added, including own goals', () => {
    const draft = {
      ...emptyResultDraft(),
      goals: [
        { key: '1', side: 'HOME' as const, ownGoal: false, scorerUserId: A, assistUserId: B },
        { key: '2', side: 'HOME' as const, ownGoal: true, scorerUserId: '', assistUserId: '' },
        { key: '3', side: 'AWAY' as const, ownGoal: false, scorerUserId: C, assistUserId: '' },
      ],
    };
    expect(toRefereeResultInput(draft)).toEqual({
      outcome: 'PLAYED',
      homeScore: 2,
      awayScore: 1,
      goals: [
        { side: 'HOME', ownGoal: false, scorerUserId: A, assistUserId: B },
        { side: 'HOME', ownGoal: true },
        { side: 'AWAY', ownGoal: false, scorerUserId: C },
      ],
      didNotPlayUserIds: [],
    });
    expect(draftProblems(draft, lineup)).toEqual([]);
    expect(describeGoals(draft, lineup, sides)).toEqual(['Team A: Ann (assist Ben)', 'Team A: own goal by an opponent', 'Team B: Cara']);
  });

  it('explains what is missing in plain words', () => {
    const draft = { ...emptyResultDraft(), goals: [{ key: '1', side: 'HOME' as const, ownGoal: false, scorerUserId: '', assistUserId: '' }] };
    expect(draftProblems(draft, lineup)).toEqual(['Pick the scorer, or mark the goal as an own goal.']);
    expect(draftProblems({ ...emptyResultDraft(), outcome: 'FORFEIT' }, lineup)).toEqual(['Choose which team wins the forfeit.']);
  });

  it('sends a forfeit or abandoned match as 0-0 with no goals', () => {
    const goal = { key: '1', side: 'HOME' as const, ownGoal: true, scorerUserId: '', assistUserId: '' };
    expect(toRefereeResultInput({ outcome: 'FORFEIT', forfeitWinner: 'AWAY', goals: [goal], didNotPlayUserIds: [] })).toEqual({
      outcome: 'FORFEIT', homeScore: 0, awayScore: 0, forfeitWinner: 'AWAY', goals: [], didNotPlayUserIds: [],
    });
    expect(toRefereeResultInput({ outcome: 'ABANDONED', forfeitWinner: '', goals: [goal], didNotPlayUserIds: [B] })).toMatchObject({ homeScore: 0, awayScore: 0, goals: [], didNotPlayUserIds: [B] });
  });
});
