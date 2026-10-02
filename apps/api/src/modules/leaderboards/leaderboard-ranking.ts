import type { LeaderboardBoard, LeaderboardRow } from '@footy-finder/shared';

/** Batch 5 brief, B3: each board shows the top 10; a viewer outside it gets their own place underneath. */
export const LEADERBOARD_SIZE = 10;

/** The first instant of the current calendar month in South African time (UTC+2, no daylight saving). */
export const saMonthStart = (now: Date) => {
  const local = new Date(now.getTime() + 2 * 3_600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - 2 * 3_600_000);
};

/** A player's totals for the period, plus what the tie-breakers need. */
export type LeaderboardCandidate = Omit<LeaderboardRow, 'rank' | 'value'> & {
  matches: number;
  goals: number;
  assists: number;
  /**
   * Kick-off of the match in which the player reached their current total on each board (the latest counted match
   * for matches; the latest match with a goal / an assist for goals / assists). Earlier wins a tie (CEO D16).
   */
  reachedAt: Record<LeaderboardBoard, Date | null>;
  /** When the player joined FootyFinder: the last tie-breaker, so the order is always strict (CEO D16). */
  joinedAt: Date;
};

const time = (date: Date | null) => date?.getTime() ?? Number.MAX_SAFE_INTEGER;
const higher = (a: number, b: number) => b - a;
const lower = (a: number, b: number) => a - b;

/**
 * Batch 5 brief, B3 (CEO D16): a strict 1, 2, 3… order, no shared places.
 * - Most matches: matches, then goals + assists, then whoever reached the total first.
 * - Most goals: goals, then fewer matches played, then assists, then reached first.
 * - Most assists: assists, then fewer matches played, then goals, then reached first.
 * Any remaining tie goes to whoever joined FootyFinder first (then the id, for a stable order).
 */
const COMPARE: Record<LeaderboardBoard, (a: LeaderboardCandidate, b: LeaderboardCandidate) => number> = {
  matches: (a, b) => higher(a.matches, b.matches) || higher(a.goals + a.assists, b.goals + b.assists),
  goals: (a, b) => higher(a.goals, b.goals) || lower(a.matches, b.matches) || higher(a.assists, b.assists),
  assists: (a, b) => higher(a.assists, b.assists) || lower(a.matches, b.matches) || higher(a.goals, b.goals),
};

/**
 * Ranks players on one board. Players with 0 on that board are left out. The top `size` places are shown; the
 * viewer's own row is returned separately when they are ranked but not shown.
 */
export function rankLeaderboard(
  players: LeaderboardCandidate[],
  board: LeaderboardBoard,
  viewerId?: string | null,
  size = LEADERBOARD_SIZE,
): { rows: LeaderboardRow[]; viewer: LeaderboardRow | null } {
  const ranked: LeaderboardRow[] = players
    .filter((player) => player[board] > 0)
    .sort((a, b) =>
      COMPARE[board](a, b)
      || time(a.reachedAt[board]) - time(b.reachedAt[board])
      || a.joinedAt.getTime() - b.joinedAt.getTime()
      || a.userId.localeCompare(b.userId))
    .map((player, index) => ({ rank: index + 1, userId: player.userId, displayName: player.displayName, avatarUrl: player.avatarUrl, value: player[board] }));
  const rows = ranked.slice(0, size);
  const viewer = viewerId && !rows.some(({ userId }) => userId === viewerId) ? ranked.find(({ userId }) => userId === viewerId) ?? null : null;
  return { rows, viewer };
}
