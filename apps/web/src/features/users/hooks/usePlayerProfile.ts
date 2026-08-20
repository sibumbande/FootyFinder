import type { UpdatePlayerProfileInput } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { currentUserKey } from '@/features/auth/hooks/useAuth.js';
import { usersApiClient } from '../api/users.js';
export const playerProfileKey = (id: string) => ['players', id] as const;
export const usePlayerProfile = (id: string) =>
  useQuery({
    queryKey: playerProfileKey(id),
    queryFn: async () => (await usersApiClient.profile(id)).data,
    enabled: Boolean(id),
  });
export function useUpdatePlayerProfile(userId: string) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePlayerProfileInput) => usersApiClient.updateProfile(input),
    onSuccess: ({ data }) => {
      cache.setQueryData(currentUserKey, data);
      cache.setQueryData(playerProfileKey(userId), data);
      void cache.invalidateQueries({ queryKey: ['users'] });
    },
  });
}
