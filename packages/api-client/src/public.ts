import type { GuestPlayerProfile, Leaderboard, LeaderboardBoard, LeaderboardPeriod, LookingCardView, MatchFormat, PublicMatchPreview, PublicTeamView, RecruitmentPostView } from '@footy-finder/shared';
import type { ApiClient } from './client.js';
import type { RecruitmentFilters } from './recruitment.js';

const id = encodeURIComponent;
const query = (filters: Record<string, string | undefined> = {}) => {
  const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => Boolean(value)) as Array<[string, string]>);
  const text = params.toString();
  return text ? `?${text}` : '';
};

/** Gate 9 / TKT-910: read-only guest browsing (no account). */
export const publicApi = (client: ApiClient) => ({
  matches: (format?: MatchFormat) => client.request<{ data: PublicMatchPreview[] }>(`/public/matches${query({ format })}`),
  matchById: (matchId: string) => client.request<{ data: PublicMatchPreview }>(`/public/matches/by-id/${id(matchId)}`),
  team: (teamId: string) => client.request<{ data: PublicTeamView }>(`/public/teams/${id(teamId)}`),
  player: (userId: string) => client.request<{ data: GuestPlayerProfile }>(`/public/players/${id(userId)}`),
  recruitmentPosts: (filters?: RecruitmentFilters) => client.request<{ data: RecruitmentPostView[] }>(`/public/recruitment/posts${query(filters)}`),
  lookingPlayers: (filters?: RecruitmentFilters) => client.request<{ data: LookingCardView[] }>(`/public/recruitment/looking${query(filters)}`),
  /** CEO touch-up batch 3.5, item 6 (sends the session cookie when there is one, for the viewer's own place). */
  leaderboard: (board: LeaderboardBoard, period: LeaderboardPeriod) =>
    client.request<{ data: Leaderboard }>(`/public/leaderboards${query({ board, period })}`),
});
