import type { Relationship } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { socialClient } from '@/api/client.js';
import { currentUserKey, useAuth } from '@/features/auth/hooks/useAuth.js';
import { myTeamsKey } from '@/features/teams/hooks/useTeams.js';

export const socialKey = ['social'] as const;
export const relationshipKey = (userId: string) => [...socialKey, 'relationship', userId] as const;

/**
 * Every "Add friend" button asks for its own state; this collects the ids asked for in the same
 * tick into one /social/relationships call (at most 100 per call).
 */
let pending = new Map<string, Array<(value: Relationship) => void>>();
let timer: ReturnType<typeof setTimeout> | undefined;
async function flush() {
  const batch = pending;
  pending = new Map();
  timer = undefined;
  const ids = [...batch.keys()];
  for (let start = 0; start < ids.length; start += 100) {
    const chunk = ids.slice(start, start + 100);
    try {
      const { data } = await socialClient.relationships(chunk);
      const byId = new Map(data.map((item) => [item.userId, item]));
      for (const id of chunk)
        for (const resolve of batch.get(id) ?? []) resolve(byId.get(id) ?? { userId: id, state: 'UNAVAILABLE' });
    } catch {
      for (const id of chunk) for (const resolve of batch.get(id) ?? []) resolve({ userId: id, state: 'UNAVAILABLE' });
    }
  }
}
export function loadRelationship(userId: string) {
  return new Promise<Relationship>((resolve) => {
    pending.set(userId, [...(pending.get(userId) ?? []), resolve]);
    timer ??= setTimeout(() => void flush(), 10);
  });
}

export function useRelationship(userId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: relationshipKey(userId ?? ''),
    queryFn: () => loadRelationship(userId!),
    enabled: Boolean(userId && user && user.onboardingComplete),
    staleTime: 30_000,
  });
}

const invalidateSocial = (cache: QueryClient) => cache.invalidateQueries({ queryKey: socialKey });

export const useSocialSummary = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...socialKey, 'summary'],
    queryFn: async () => (await socialClient.summary()).data,
    enabled: Boolean(user?.onboardingComplete),
    refetchInterval: 30_000,
  });
};
const seed = <T extends { relationship: Relationship }>(cache: QueryClient, cards: T[]) => {
  for (const { relationship } of cards) cache.setQueryData(relationshipKey(relationship.userId), relationship);
  return cards;
};
export const useDiscover = (q: string) => {
  const cache = useQueryClient();
  return useQuery({ queryKey: [...socialKey, 'discover', q], queryFn: async () => seed(cache, (await socialClient.search(q || undefined)).data) });
};
export const useFriends = () => {
  const cache = useQueryClient();
  return useQuery({ queryKey: [...socialKey, 'friends'], queryFn: async () => seed(cache, (await socialClient.friends()).data) });
};
export const useFriendRequests = () =>
  useQuery({ queryKey: [...socialKey, 'requests'], queryFn: async () => (await socialClient.requests()).data });
export const useBlocks = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...socialKey, 'blocks'],
    queryFn: async () => (await socialClient.blocks()).data,
    enabled: Boolean(user?.onboardingComplete),
    staleTime: 60_000,
  });
};
export const useSocialSettings = () =>
  useQuery({ queryKey: [...socialKey, 'settings'], queryFn: async () => (await socialClient.settings()).data });
export const usePlayedWith = (matchId: string, enabled = true) => {
  const cache = useQueryClient();
  return useQuery({
    queryKey: [...socialKey, 'played-with', matchId],
    queryFn: async () => {
      const view = (await socialClient.playedWith(matchId)).data;
      seed(cache, view.players);
      return view;
    },
    enabled,
    retry: false,
  });
};

type FriendAction =
  | { kind: 'send'; userId: string }
  | { kind: 'accept' | 'decline' | 'cancel'; requestId: string }
  | { kind: 'remove' | 'block' | 'unblock'; userId: string };
export function useFriendAction() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: async (action: FriendAction) => {
      switch (action.kind) {
        case 'send': return (await socialClient.sendRequest(action.userId)).data;
        case 'accept': return (await socialClient.acceptRequest(action.requestId)).data;
        case 'decline': return (await socialClient.declineRequest(action.requestId)).data;
        case 'cancel': return (await socialClient.cancelRequest(action.requestId)).data;
        case 'remove': return (await socialClient.removeFriend(action.userId)).data;
        case 'block': await socialClient.block(action.userId); return undefined;
        case 'unblock': await socialClient.unblock(action.userId); return undefined;
      }
    },
    onSuccess: (relationship) => {
      if (relationship) cache.setQueryData(relationshipKey(relationship.userId), relationship);
      void invalidateSocial(cache);
    },
  });
}
export function useUpdateSocialSettings() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: async (friendRequestsEnabled: boolean) => (await socialClient.updateSettings({ friendRequestsEnabled })).data,
    onSuccess: () => void invalidateSocial(cache),
  });
}
export function useAddAll(matchId: string) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: async () => (await socialClient.addAll(matchId)).data,
    onSuccess: () => void invalidateSocial(cache),
  });
}

/** Gate 9 / TKT-904: personal team invites. */
export const useMyTeamInvites = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...socialKey, 'team-invites'],
    queryFn: async () => (await socialClient.myTeamInvites()).data,
    enabled: Boolean(user?.onboardingComplete),
  });
};
export const useTeamMemberInvites = (teamId: string, enabled = true) =>
  useQuery({ queryKey: [...socialKey, 'team-member-invites', teamId], queryFn: async () => (await socialClient.teamMemberInvites(teamId)).data, enabled });
export const useInvitableFriends = (teamId: string, enabled = true) =>
  useQuery({ queryKey: [...socialKey, 'invitable-friends', teamId], queryFn: async () => (await socialClient.invitableFriends(teamId)).data, enabled });
export function useTeamInviteAction() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: async (
      action:
        | { kind: 'invite'; teamId: string; userId: string; source?: 'FRIEND' | 'LOOKING' }
        | { kind: 'cancel'; teamId: string; inviteId: string }
        | { kind: 'accept' | 'decline'; inviteId: string },
    ) => {
      if (action.kind === 'invite') return (await socialClient.inviteToTeam(action.teamId, action.userId, action.source)).data;
      if (action.kind === 'cancel') return (await socialClient.cancelTeamInvite(action.teamId, action.inviteId)).data;
      if (action.kind === 'accept') return (await socialClient.acceptTeamInvite(action.inviteId)).data;
      return (await socialClient.declineTeamInvite(action.inviteId)).data;
    },
    onSuccess: (_data, action) => {
      void invalidateSocial(cache);
      if (action.kind === 'accept') {
        void cache.invalidateQueries({ queryKey: myTeamsKey });
        void cache.invalidateQueries({ queryKey: currentUserKey });
      }
    },
  });
}
