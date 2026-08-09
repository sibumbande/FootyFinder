import type { LoginInput, PublicUser, RegisterInput } from '@footy-finder/shared';
import { ApiError } from '@footy-finder/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authApiClient, usersClient } from '../api/auth.js';

export const currentUserKey = ['auth', 'current-user'] as const;

export function useCurrentUser() {
  return useQuery<PublicUser | null>({
    queryKey: currentUserKey,
    queryFn: async () => {
      try { return (await usersClient.me()).data; }
      catch (error) { if (error instanceof ApiError && error.status === 401) return null; throw error; }
    },
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (input: LoginInput) => authApiClient.login(input), onSuccess: ({ data }) => queryClient.setQueryData(currentUserKey, data) });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (input: RegisterInput) => authApiClient.register(input), onSuccess: ({ data }) => queryClient.setQueryData(currentUserKey, data) });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: () => authApiClient.logout(), onSettled: async () => { await queryClient.cancelQueries(); queryClient.clear(); queryClient.setQueryData(currentUserKey, null); } });
}

export function useAuth() {
  const currentUser = useCurrentUser();
  return { ...currentUser, user: currentUser.data ?? null, isAuthenticated: Boolean(currentUser.data) };
}
