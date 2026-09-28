import type { TeamSide } from '@footy-finder/shared';

/**
 * DEC-013 presentation for Quick Matches: sides are "Team A" and "Team B" with a letter badge, so
 * they are never distinguished by colour alone. Colours stay as the existing home (blue) and away
 * (red) theme tokens (CEO decision). The stored side values remain HOME/AWAY.
 */
export const QUICK_MATCH_SIDE_LABELS: Record<TeamSide, string> = { HOME: 'Team A', AWAY: 'Team B' };
export const QUICK_MATCH_SIDE_BADGES: Record<TeamSide, string> = { HOME: 'A', AWAY: 'B' };
export const QUICK_MATCH_RESERVE_LABELS: Record<TeamSide, string> = {
  HOME: 'Team A reserves',
  AWAY: 'Team B reserves',
};
