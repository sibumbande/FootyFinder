import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { teamChatClient } from '@/api/client.js';
import { teamKey } from './useTeams.js';

export const teamChatKey = (teamId: string) => [...teamKey(teamId), 'chat'] as const;

/** Gate 7 / TKT-711: pages of retained team chat, newest page first (each page oldest-first). */
export const useTeamChat = (teamId: string, enabled = true) =>
  useInfiniteQuery({
    queryKey: teamChatKey(teamId),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => (await teamChatClient.history(teamId, { before: pageParam })).data,
    getNextPageParam: (page) => page.olderCursor ?? undefined,
    enabled: Boolean(teamId) && enabled,
  });

export function useSendTeamChatMessage(teamId: string) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => teamChatClient.send(teamId, content),
    onSuccess: () => void cache.invalidateQueries({ queryKey: teamChatKey(teamId) }),
  });
}

export function useMarkTeamChatRead(teamId: string) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: () => teamChatClient.markRead(teamId),
    onSuccess: () => void cache.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
