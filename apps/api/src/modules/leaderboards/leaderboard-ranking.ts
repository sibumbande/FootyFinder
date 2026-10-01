import type { LeaderboardRow } from '@footy-finder/shared';

/** CEO touch-up batch 3.5, item 6: how many places a board shows (more when players tie for the last place). */
export const LEADERBOARD_SIZE = 20;

/** The first instant of the current calendar month in South African time (UTC+2, no daylight saving). */
export const saMonthStart = (now: Date) => {
  const local = new Date(now.getTime() + 2 * 3_600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - 2 * 3_600_000);
};

/**
 * Ranks players by value, highest first. Players with 0 are left out; ties share a rank (1, 2, 2, 4) and are
 * listed by name. The top LEADERBOARD_SIZE places are shown, plus everyone tied with the last of them; the
 * viewer's own row is returned separately when they are ranked but not shown.
 */
export function rankLeaderboard(
  players: Array<Omit<LeaderboardRow, 'rank'>>,
  viewerId?: string | null,
  size = LEADERBOARD_SIZE,
): { rows: LeaderboardRow[]; viewer: LeaderboardRow | null } {
  const sorted = players
    .filter(({ value }) => value > 0)
    .sort((a, b) => b.value - a.value || a.displayName.localeCompare(b.displayName, 'en') || a.userId.localeCompare(b.userId));
  const ranked: LeaderboardRow[] = [];
  sorted.forEach((player, index) => {
    const rank = index > 0 && sorted[index - 1]!.value === player.value ? ranked[index - 1]!.rank : index + 1;
    ranked.push({ ...player, rank });
  });
  const cutoff = ranked[size - 1]?.rank;
  const rows = cutoff === undefined ? ranked : ranked.filter(({ rank }) => rank <= cutoff);
  const viewer = viewerId && !rows.some(({ userId }) => userId === viewerId) ? ranked.find(({ userId }) => userId === viewerId) ?? null : null;
  return { rows, viewer };
}
