import type { ConfirmAccountDeletionInput, DataExportInput } from '@footy-finder/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { accountClient } from '@/api/client.js';

export const deletionPreviewKey = ['account', 'deletion-preview'] as const;

export const useDeletionPreview = () =>
  useQuery({
    queryKey: deletionPreviewKey,
    queryFn: async () => (await accountClient.deletionPreview()).data,
    staleTime: 0,
  });

export const useRequestDeletion = () =>
  useMutation({ mutationFn: (input: ConfirmAccountDeletionInput) => accountClient.requestDeletion(input) });

export const useDownloadData = () =>
  useMutation({ mutationFn: async (input: DataExportInput) => accountClient.downloadData(input) });
