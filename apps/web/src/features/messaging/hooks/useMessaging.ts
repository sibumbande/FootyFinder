import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { messagingClient } from '@/api/client.js';
export const conversationsKey = ['conversations'] as const;
export const conversationKey = (id: string) => [...conversationsKey, id] as const;
export const useConversations = () =>
  useQuery({
    queryKey: conversationsKey,
    queryFn: async () => (await messagingClient.list()).data,
    refetchInterval: 10_000,
  });
export const useConversation = (id?: string) =>
  useQuery({
    queryKey: conversationKey(id ?? ''),
    queryFn: async () => (await messagingClient.get(id!)).data,
    enabled: Boolean(id),
    refetchInterval: 5_000,
  });
export function useStartConversation() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => messagingClient.start(userId),
    onSuccess: () => void cache.invalidateQueries({ queryKey: conversationsKey }),
  });
}
export function useSendDirectMessage(id: string) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => messagingClient.send(id, { content }),
    onSuccess: () =>
      void Promise.all([
        cache.invalidateQueries({ queryKey: conversationKey(id) }),
        cache.invalidateQueries({ queryKey: conversationsKey }),
      ]),
  });
}
