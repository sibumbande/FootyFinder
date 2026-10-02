/** CEO touch-up batch 3.5, item 6: the Social leaderboards (Cape Town; final results only). */
export const LEADERBOARD_BOARDS = ['matches', 'goals', 'assists'] as const;
export type LeaderboardBoard = (typeof LEADERBOARD_BOARDS)[number];
export const LEADERBOARD_PERIODS = ['month', 'all'] as const;
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];

export interface LeaderboardRow {
  /** A strict place, 1, 2, 3… (ties are broken by the board's tie-breakers, batch 5 brief B3). */
  rank: number;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  value: number;
}

export interface Leaderboard {
  board: LeaderboardBoard;
  period: LeaderboardPeriod;
  /** The first day of the month counted (South African time), for "This month". */
  since: string | null;
  rows: LeaderboardRow[];
  /** The signed-in viewer's own place when they are not in rows (null when they have none yet). */
  viewer: LeaderboardRow | null;
}
