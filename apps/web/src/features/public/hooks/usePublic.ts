import type { MatchFormat } from '@footy-finder/shared';
import { useQuery } from '@tanstack/react-query';
import { publicClient } from '@/api/client.js';

/** Gate 9 / TKT-910: read-only guest data from the /public routes. */
export const publicKey = ['public'] as const;
export const usePublicMatches = (format?: MatchFormat) =>
  useQuery({ queryKey: [...publicKey, 'matches', format ?? ''], queryFn: async () => (await publicClient.matches(format)).data });
export const usePublicTeam = (teamId: string) =>
  useQuery({ queryKey: [...publicKey, 'team', teamId], queryFn: async () => (await publicClient.team(teamId)).data, retry: false });
export const usePublicPlayer = (userId: string) =>
  useQuery({ queryKey: [...publicKey, 'player', userId], queryFn: async () => (await publicClient.player(userId)).data, retry: false });
