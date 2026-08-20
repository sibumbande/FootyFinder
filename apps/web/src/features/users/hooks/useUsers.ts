import { useQuery } from '@tanstack/react-query';
import { usersApiClient } from '../api/users.js';
export function useUsers() {
  return useQuery({ queryKey: ['users'], queryFn: async () => (await usersApiClient.list()).data });
}
