import { z } from 'zod';

/**
 * Gate 8 / TKT-804 (DEC-020): the result the FootyFinder referee records, which is final (D5).
 * Each goal is credited to a side. It names a scorer and an optional assister from that side's
 * kickoff lineup, or it is an own goal, which counts for the side and names nobody (D7).
 * Outcomes (D13): PLAYED, FORFEIT (one side did not turn up: winner, 0-0, no goals) and ABANDONED
 * (0-0, no goals, no statistics). didNotPlayUserIds are lineup players the referee unticks (D14).
 */
export const RESULT_OUTCOMES = ['PLAYED', 'FORFEIT', 'ABANDONED'] as const;
export type ResultOutcome = (typeof RESULT_OUTCOMES)[number];

export const recordedGoalSchema = z.object({
  side: z.enum(['HOME', 'AWAY']),
  scorerUserId: z.string().uuid().optional(),
  assistUserId: z.string().uuid().optional(),
  ownGoal: z.boolean().default(false),
});
export type RecordedGoalInput = z.infer<typeof recordedGoalSchema>;

export const refereeResultSchema = z.object({
  outcome: z.enum(RESULT_OUTCOMES),
  homeScore: z.number().int().min(0).max(99),
  awayScore: z.number().int().min(0).max(99),
  forfeitWinner: z.enum(['HOME', 'AWAY']).optional(),
  goals: z.array(recordedGoalSchema).max(198).default([]),
  didNotPlayUserIds: z.array(z.string().uuid()).max(100).default([]),
});
export type RefereeResultInput = z.infer<typeof refereeResultSchema>;

/**
 * Gate 8 / TKT-806 (D10, D11): a captain's (or Quick Match host's) optional own version, sent as
 * evidence for admins only. Scorers are optional: a goal may leave the scorer unknown, and the
 * goals may be left out altogether (score only). It never changes the referee's result.
 */
export const captainResultSchema = refereeResultSchema.omit({ didNotPlayUserIds: true });
export type CaptainResultInput = z.infer<typeof captainResultSchema>;

/** D6: captains cannot dispute a final result, but may report a problem within 24 hours. */
export const reportResultProblemSchema = z.object({
  message: z.string().trim().min(10).max(2000),
});
export type ReportResultProblemInput = z.infer<typeof reportResultProblemSchema>;

export type MatchResultProblem =
  | 'GOAL_COUNT_MISMATCH'
  | 'FORFEIT_WINNER_REQUIRED'
  | 'FORFEIT_WINNER_NOT_ALLOWED'
  | 'NO_GOALS_ALLOWED'
  | 'SCORER_REQUIRED'
  | 'OWN_GOAL_NAMES_NOBODY'
  | 'SCORER_NOT_IN_LINEUP'
  | 'ASSIST_NOT_IN_LINEUP'
  | 'ASSIST_IS_SCORER'
  | 'PLAYER_DID_NOT_PLAY'
  | 'DID_NOT_PLAY_NOT_IN_LINEUP';

export const MATCH_RESULT_PROBLEM_MESSAGES: Record<MatchResultProblem, string> = {
  GOAL_COUNT_MISMATCH: "Each team's goals must add up to its score.",
  FORFEIT_WINNER_REQUIRED: 'Choose which team wins the forfeit.',
  FORFEIT_WINNER_NOT_ALLOWED: 'Only a forfeit has a forfeit winner.',
  NO_GOALS_ALLOWED: 'A forfeit or abandoned match is recorded as 0-0 with no goals.',
  SCORER_REQUIRED: 'Pick the scorer, or mark the goal as an own goal.',
  OWN_GOAL_NAMES_NOBODY: 'An own goal counts for the team only; it has no scorer or assister.',
  SCORER_NOT_IN_LINEUP: "The scorer must be in that team's lineup.",
  ASSIST_NOT_IN_LINEUP: "The assister must be in that team's lineup.",
  ASSIST_IS_SCORER: 'A player cannot assist their own goal.',
  PLAYER_DID_NOT_PLAY: 'A player marked as not playing cannot score or assist.',
  DID_NOT_PLAY_NOT_IN_LINEUP: 'Only players in the lineup can be marked as not playing.',
};

/**
 * Checks a recorded result against the kickoff lineup. Returns every problem found (none = valid).
 * `captain` (TKT-806): scorers may be unknown and the goals may be left out (score only).
 */
export function validateMatchResult(
  input: Pick<RefereeResultInput, 'outcome' | 'homeScore' | 'awayScore' | 'forfeitWinner'> & {
    didNotPlayUserIds?: string[];
    goals: Array<Pick<RecordedGoalInput, 'side' | 'scorerUserId' | 'assistUserId'> & { ownGoal?: boolean }>;
  },
  lineup: ReadonlyArray<{ userId: string; side: 'HOME' | 'AWAY' }>,
  options: { captain?: boolean } = {},
): MatchResultProblem[] {
  const problems = new Set<MatchResultProblem>();
  const sideOf = new Map(lineup.map(({ userId, side }) => [userId, side]));
  const didNotPlayUserIds = input.didNotPlayUserIds ?? [];
  const didNotPlay = new Set(didNotPlayUserIds);
  if (didNotPlayUserIds.some((userId) => !sideOf.has(userId))) problems.add('DID_NOT_PLAY_NOT_IN_LINEUP');
  if (input.outcome === 'FORFEIT' && !input.forfeitWinner) problems.add('FORFEIT_WINNER_REQUIRED');
  if (input.outcome !== 'FORFEIT' && input.forfeitWinner) problems.add('FORFEIT_WINNER_NOT_ALLOWED');
  if (input.outcome !== 'PLAYED') {
    if (input.goals.length || input.homeScore || input.awayScore) problems.add('NO_GOALS_ALLOWED');
    return [...problems];
  }
  const count = (side: 'HOME' | 'AWAY') => input.goals.filter((goal) => goal.side === side).length;
  const scoreOnly = options.captain && input.goals.length === 0;
  if (!scoreOnly && (count('HOME') !== input.homeScore || count('AWAY') !== input.awayScore)) problems.add('GOAL_COUNT_MISMATCH');
  for (const goal of input.goals) {
    if (goal.ownGoal) {
      if (goal.scorerUserId || goal.assistUserId) problems.add('OWN_GOAL_NAMES_NOBODY');
      continue;
    }
    if (!goal.scorerUserId) {
      if (!options.captain) problems.add('SCORER_REQUIRED');
      else if (goal.assistUserId && sideOf.get(goal.assistUserId) !== goal.side) problems.add('ASSIST_NOT_IN_LINEUP');
      continue;
    }
    if (sideOf.get(goal.scorerUserId) !== goal.side) problems.add('SCORER_NOT_IN_LINEUP');
    if (didNotPlay.has(goal.scorerUserId)) problems.add('PLAYER_DID_NOT_PLAY');
    if (goal.assistUserId) {
      if (goal.assistUserId === goal.scorerUserId) problems.add('ASSIST_IS_SCORER');
      else if (sideOf.get(goal.assistUserId) !== goal.side) problems.add('ASSIST_NOT_IN_LINEUP');
      if (didNotPlay.has(goal.assistUserId)) problems.add('PLAYER_DID_NOT_PLAY');
    }
  }
  return [...problems];
}

/** Gate 8 / TKT-807 (D3, D5, D25): an admin enters or corrects a final result, with a written reason. */
export const adminResultEntrySchema = z.object({
  result: refereeResultSchema,
  reason: z.string().trim().min(3).max(500),
});
export type AdminResultEntryInput = z.infer<typeof adminResultEntrySchema>;
