import type { TeamMatchOtherSideMode, TeamMatchOtherSideTakenBy } from '../config/team-match-fees.js';

/**
 * Gate 7 / TKT-705 (DEC-019 decisions B, C, N1, N5): the other side of a team match.
 *
 *   (open) --team loads--------------------> TEAM
 *   (open) --first individual joins--------> INDIVIDUALS        ("Open to both" only)
 *   INDIVIDUALS, nobody joined --team loads> TEAM               (N1: the side reopens)
 *   TEAM --that team withdraws before T-30-> (open)             (N5)
 *
 * There is no approval step: whoever comes first takes the side, under the Match row lock.
 */
export type OtherSideTaker = 'TEAM' | 'INDIVIDUAL';
export type OtherSideRefusal = 'TEAMS_ONLY' | 'TAKEN_BY_TEAM' | 'TAKEN_BY_INDIVIDUALS';
export type OtherSideDecision =
  | { allowed: true; next: TeamMatchOtherSideTakenBy }
  | { allowed: false; reason: OtherSideRefusal };

export function decideOtherSide(
  state: { mode: TeamMatchOtherSideMode; takenBy: TeamMatchOtherSideTakenBy | null; joinedIndividuals: number },
  taker: OtherSideTaker,
): OtherSideDecision {
  if (state.takenBy === 'TEAM') return { allowed: false, reason: 'TAKEN_BY_TEAM' };
  if (taker === 'INDIVIDUAL')
    return state.mode === 'TEAMS_ONLY' ? { allowed: false, reason: 'TEAMS_ONLY' } : { allowed: true, next: 'INDIVIDUALS' };
  if (state.takenBy === 'INDIVIDUALS' && state.joinedIndividuals > 0) return { allowed: false, reason: 'TAKEN_BY_INDIVIDUALS' };
  return { allowed: true, next: 'TEAM' };
}

/** N1: an individuals side with nobody left in it is open again. */
export const effectiveOtherSide = (takenBy: TeamMatchOtherSideTakenBy | null, joinedIndividuals: number) =>
  takenBy === 'INDIVIDUALS' && joinedIndividuals === 0 ? null : takenBy;

export const OTHER_SIDE_REFUSAL_MESSAGE: Record<OtherSideRefusal, string> = {
  TEAMS_ONLY: 'Only another team can take the other side of this match.',
  TAKEN_BY_TEAM: 'Another team has already taken the other side.',
  TAKEN_BY_INDIVIDUALS: 'Players have already joined the other side, so a team can no longer load into it.',
};
