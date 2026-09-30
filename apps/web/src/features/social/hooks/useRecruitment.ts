import type { LookingCardInput, RecruitmentPostInput } from '@footy-finder/shared';
import type { RecruitmentFilters } from '@footy-finder/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { recruitmentClient } from '@/api/client.js';
import { currentUserKey, useAuth } from '@/features/auth/hooks/useAuth.js';
import { myTeamsKey } from '@/features/teams/hooks/useTeams.js';

/** Gate 9 / TKT-909: the team recruitment board. */
export const recruitmentKey = ['recruitment'] as const;

export const useRecruitmentPosts = (filters: RecruitmentFilters) =>
  useQuery({ queryKey: [...recruitmentKey, 'posts', filters], queryFn: async () => (await recruitmentClient.posts(filters)).data });
export const useLookingPlayers = (filters: RecruitmentFilters) =>
  useQuery({ queryKey: [...recruitmentKey, 'looking', filters], queryFn: async () => (await recruitmentClient.looking(filters)).data });
export const useMyLookingCard = () => {
  const { user } = useAuth();
  return useQuery({ queryKey: [...recruitmentKey, 'my-card'], queryFn: async () => (await recruitmentClient.myCard()).data, enabled: Boolean(user?.onboardingComplete) });
};
export const useMyJoinRequests = () => {
  const { user } = useAuth();
  return useQuery({ queryKey: [...recruitmentKey, 'my-requests'], queryFn: async () => (await recruitmentClient.myJoinRequests()).data, enabled: Boolean(user?.onboardingComplete) });
};
export const useTeamRecruitmentPosts = (teamId: string, enabled = true) =>
  useQuery({ queryKey: [...recruitmentKey, 'team-posts', teamId], queryFn: async () => (await recruitmentClient.teamPosts(teamId)).data, enabled });
export const useTeamJoinRequests = (teamId: string, enabled = true) =>
  useQuery({ queryKey: [...recruitmentKey, 'team-requests', teamId], queryFn: async () => (await recruitmentClient.teamJoinRequests(teamId)).data, enabled });

type RecruitmentAction =
  | { kind: 'ask'; postId: string }
  | { kind: 'cancel-request'; requestId: string }
  | { kind: 'create'; teamId: string; input: RecruitmentPostInput }
  | { kind: 'update'; teamId: string; postId: string; input: RecruitmentPostInput }
  | { kind: 'renew' | 'close'; teamId: string; postId: string }
  | { kind: 'accept' | 'decline'; teamId: string; requestId: string }
  | { kind: 'card'; input: LookingCardInput };
export function useRecruitmentAction() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: async (action: RecruitmentAction) => {
      switch (action.kind) {
        case 'ask': return (await recruitmentClient.askToJoin(action.postId)).data;
        case 'cancel-request': return (await recruitmentClient.cancelJoinRequest(action.requestId)).data;
        case 'create': return (await recruitmentClient.createPost(action.teamId, action.input)).data;
        case 'update': return (await recruitmentClient.updatePost(action.teamId, action.postId, action.input)).data;
        case 'renew': return (await recruitmentClient.renewPost(action.teamId, action.postId)).data;
        case 'close': return (await recruitmentClient.closePost(action.teamId, action.postId)).data;
        case 'accept': return (await recruitmentClient.acceptJoinRequest(action.teamId, action.requestId)).data;
        case 'decline': return (await recruitmentClient.declineJoinRequest(action.teamId, action.requestId)).data;
        case 'card': return (await recruitmentClient.updateMyCard(action.input)).data;
      }
    },
    onSuccess: (_data, action) => {
      void cache.invalidateQueries({ queryKey: recruitmentKey });
      if (action.kind === 'accept') {
        void cache.invalidateQueries({ queryKey: myTeamsKey });
        void cache.invalidateQueries({ queryKey: ['teams', action.teamId] });
        void cache.invalidateQueries({ queryKey: currentUserKey });
      }
    },
  });
}
