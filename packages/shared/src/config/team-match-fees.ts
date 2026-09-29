import { getPlayersPerTeam, MAX_SUBSTITUTES_PER_TEAM, type MatchFormat } from './match-formats.js';
import { MATCH_FEE_CENTS } from '../types/wallet.js';

/**
 * Gate 7 / DEC-019: a team pays a fixed fee of R80 (set by FootyFinder; teams cannot change it)
 * for every starting position of the format plus every sub that team chooses. Each team's fee is
 * calculated separately. Venue costs are never part of this and are never shown.
 */
export const TEAM_PLACE_FEE_CENTS = MATCH_FEE_CENTS;
/** D12: a team may have at most this many published matches whose other side is not yet taken. */
export const MAX_TEAM_MATCHES_AWAITING_OPPONENT = 2;
/** DEC-015/D10: a "Teams only" match with no opponent this long before kickoff is cancelled. */
export const TEAM_MATCH_UNMATCHED_CANCEL_HOURS = 24;

export const TEAM_MATCH_OTHER_SIDE_MODES = ['TEAMS_ONLY', 'OPEN'] as const;
export type TeamMatchOtherSideMode = (typeof TEAM_MATCH_OTHER_SIDE_MODES)[number];
export type TeamMatchOtherSideTakenBy = 'TEAM' | 'INDIVIDUALS';

export interface TeamFee {
  starterCount: number;
  substituteCount: number;
  placeFeeCents: number;
  startersCents: number;
  substitutesCents: number;
  totalCents: number;
}

export function getTeamFee(format: MatchFormat, substituteCount: number): TeamFee {
  if (!Number.isInteger(substituteCount) || substituteCount < 0 || substituteCount > MAX_SUBSTITUTES_PER_TEAM)
    throw new RangeError(`Subs must be a whole number from 0 to ${MAX_SUBSTITUTES_PER_TEAM}.`);
  const starterCount = getPlayersPerTeam(format);
  return {
    starterCount,
    substituteCount,
    placeFeeCents: TEAM_PLACE_FEE_CENTS,
    startersCents: starterCount * TEAM_PLACE_FEE_CENTS,
    substitutesCents: substituteCount * TEAM_PLACE_FEE_CENTS,
    totalCents: (starterCount + substituteCount) * TEAM_PLACE_FEE_CENTS,
  };
}

/** "R1,120" for whole rands, "R12.50" otherwise. Locale-independent. */
export function formatRandAmount(cents: number) {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const rands = Math.floor(absolute / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const remainder = absolute % 100;
  return `${sign}R${rands}${remainder ? `.${String(remainder).padStart(2, '0')}` : ''}`;
}

/** "R880 (11 players) + R240 (3 subs) = R1,120" (DEC-019 wording). */
export function formatTeamFeeBreakdown(fee: TeamFee) {
  const players = `${formatRandAmount(fee.startersCents)} (${fee.starterCount} players)`;
  const subs = `${formatRandAmount(fee.substitutesCents)} (${fee.substituteCount} ${fee.substituteCount === 1 ? 'sub' : 'subs'})`;
  return `${players} + ${subs} = ${formatRandAmount(fee.totalCents)}`;
}
