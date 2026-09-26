import type { CityInterestInput, LegalAcceptanceInput, OnboardingProfileInput } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { onboardingClient, usersClient } from '@/api/client.js';
import { currentUserKey } from '@/features/auth/hooks/useAuth.js';

export const onboardingStatusKey = ['onboarding', 'status'] as const;
export const useOnboardingStatus = () => useQuery({ queryKey: onboardingStatusKey, queryFn: async () => (await onboardingClient.status()).data });
export const useCities = () => useQuery({ queryKey: ['cities'], queryFn: async () => (await onboardingClient.cities()).data, staleTime: 60 * 60_000 });
export const useLegalDocuments = () => useQuery({ queryKey: ['legal', 'current'], queryFn: async () => (await onboardingClient.legalDocuments()).data, staleTime: 5 * 60_000 });
const refresh = (cache: ReturnType<typeof useQueryClient>) => cache.invalidateQueries({ queryKey: onboardingStatusKey });
export const useSaveOnboardingProfile = () => {
  const cache = useQueryClient();
  return useMutation({ mutationFn: (input: OnboardingProfileInput) => onboardingClient.saveProfile(input), onSuccess: () => refresh(cache) });
};
export const useJoinCityInterest = () => useMutation({ mutationFn: (input: CityInterestInput) => onboardingClient.joinCityInterest(input) });
export const useUploadPlayerPhoto = () => {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('image', file);
      return usersClient.uploadPhoto(body);
    },
    onSuccess: async () => { await refresh(cache); await cache.invalidateQueries({ queryKey: currentUserKey }); },
  });
};
export const useAcceptLegal = () => {
  const cache = useQueryClient();
  return useMutation({ mutationFn: (input: LegalAcceptanceInput) => onboardingClient.acceptLegal(input), onSuccess: () => refresh(cache) });
};
export const useCompleteOnboarding = () => {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: () => onboardingClient.complete(),
    onSuccess: ({ data }) => { cache.setQueryData(currentUserKey, data); void refresh(cache); },
  });
};
