import type {
  AuthenticatedUser,
  CityInterestInput,
  CityInterestReceipt,
  CitySummary,
  LegalAcceptanceInput,
  LegalDocumentSummary,
  OnboardingGenderInput,
  OnboardingProfileInput,
  OnboardingState,
} from '@footy-finder/shared';
import type { ApiClient } from './client.js';

export const onboardingApi = (client: ApiClient) => ({
  status: () => client.request<{ data: OnboardingState }>('/onboarding/status'),
  /** CEO touch-up batch 4, item 1: existing players answer once. */
  saveGender: (input: OnboardingGenderInput) => client.request<{ data: OnboardingState }>('/onboarding/gender', { method: 'PUT', body: JSON.stringify(input) }),
  saveProfile: (input: OnboardingProfileInput) => client.request<{ data: OnboardingState }>('/onboarding/profile', { method: 'PUT', body: JSON.stringify(input) }),
  acceptLegal: (input: LegalAcceptanceInput) => client.request<{ data: OnboardingState }>('/onboarding/legal-acceptance', { method: 'POST', body: JSON.stringify(input) }),
  complete: () => client.request<{ data: AuthenticatedUser }>('/onboarding/complete', { method: 'POST', body: JSON.stringify({ confirm: true }) }),
  cities: () => client.request<{ data: CitySummary[] }>('/cities'),
  joinCityInterest: (input: CityInterestInput) => client.request<{ data: CityInterestReceipt }>('/cities/interests', { method: 'POST', body: JSON.stringify(input) }),
  cityInterestStatus: (token: string) => client.request<{ data: unknown }>('/cities/interests/status', { method: 'POST', body: JSON.stringify({ token }) }),
  unsubscribeCityInterest: (token: string) => client.request<{ data: { success: true } }>('/cities/interests/unsubscribe', { method: 'POST', body: JSON.stringify({ token }) }),
  deleteCityInterest: (token: string) => client.request<{ data: { success: true } }>('/cities/interests', { method: 'DELETE', body: JSON.stringify({ token }) }),
  legalDocuments: () => client.request<{ data: LegalDocumentSummary[] }>('/legal/documents/current'),
});
