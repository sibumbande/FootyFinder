import { useMutation, useQueryClient } from '@tanstack/react-query';
import { walletClient } from '@/api/client.js';
import { currentUserKey } from '@/features/auth/hooks/useAuth.js';

export function useAddFunds() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await walletClient.demoDeposit(crypto.randomUUID());
      if (data.status !== 'success' || !data.user)
        throw new Error(data.message ?? 'The deposit could not be completed.');
      return data;
    },
    onSuccess: ({ user }) => queryClient.setQueryData(currentUserKey, user),
  });
}
