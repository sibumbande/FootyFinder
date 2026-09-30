import {
  MATCH_RESULT_PROBLEM_MESSAGES,
  validateMatchResult,
  type MatchLineupPlayer,
  type RefereeResultInput,
  type ResultOutcome,
} from '@footy-finder/shared';

/**
 * Gate 8 / TKT-805: the referee's result form state. The score is never typed in: each side's
 * score is the number of goals added for it, so the goals always add up.
 */
export interface GoalDraft {
  key: string;
  side: 'HOME' | 'AWAY';
  /** A player's goal, or an own goal by an opponent that counts for this side (D7). */
  ownGoal: boolean;
  scorerUserId: string;
  assistUserId: string;
}

export interface ResultDraft {
  outcome: ResultOutcome;
  forfeitWinner: 'HOME' | 'AWAY' | '';
  goals: GoalDraft[];
  /** Lineup players the referee unticked (D14). */
  didNotPlayUserIds: string[];
}

export const emptyResultDraft = (): ResultDraft => ({ outcome: 'PLAYED', forfeitWinner: '', goals: [], didNotPlayUserIds: [] });

export const scoreOf = (draft: ResultDraft, side: 'HOME' | 'AWAY') =>
  draft.outcome === 'PLAYED' ? draft.goals.filter((goal) => goal.side === side).length : 0;

export function toRefereeResultInput(draft: ResultDraft): RefereeResultInput {
  const played = draft.outcome === 'PLAYED';
  return {
    outcome: draft.outcome,
    homeScore: scoreOf(draft, 'HOME'),
    awayScore: scoreOf(draft, 'AWAY'),
    ...(draft.outcome === 'FORFEIT' && draft.forfeitWinner ? { forfeitWinner: draft.forfeitWinner } : {}),
    goals: played
      ? draft.goals.map((goal) =>
          goal.ownGoal
            ? { side: goal.side, ownGoal: true }
            : {
                side: goal.side,
                ownGoal: false,
                ...(goal.scorerUserId ? { scorerUserId: goal.scorerUserId } : {}),
                ...(goal.assistUserId ? { assistUserId: goal.assistUserId } : {}),
              },
        )
      : [],
    didNotPlayUserIds: draft.didNotPlayUserIds,
  };
}

/** The same checks the server makes, as plain sentences for the form. */
export const draftProblems = (draft: ResultDraft, lineup: MatchLineupPlayer[]) =>
  validateMatchResult(toRefereeResultInput(draft), lineup).map((problem) => MATCH_RESULT_PROBLEM_MESSAGES[problem]);

/** One line per goal for the confirmation screen, e.g. "Team A: Sam (assist Lee)". */
export function describeGoals(draft: ResultDraft, lineup: MatchLineupPlayer[], sides: { HOME: string; AWAY: string }) {
  const name = (userId: string) => lineup.find((player) => player.userId === userId)?.displayName ?? 'Unknown player';
  return draft.goals.map((goal) =>
    goal.ownGoal
      ? `${sides[goal.side]}: own goal by an opponent`
      : `${sides[goal.side]}: ${goal.scorerUserId ? name(goal.scorerUserId) : 'scorer not picked'}${goal.assistUserId ? ` (assist ${name(goal.assistUserId)})` : ''}`,
  );
}
