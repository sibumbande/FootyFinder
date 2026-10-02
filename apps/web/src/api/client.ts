import {
  refereeApi,
  ApiClient,
  authApi,
  matchesApi,
  messagingApi,
  notificationsApi,
  usersApi,
  walletApi,
  teamsApi,
  teamWalletApi,
  teamChatApi,
  supportApi,
  bookingsApi,
  moderationApi,
  disputesApi,
  onboardingApi,
  venuesApi,
  teamReviewsApi,
  socialApi,
  recruitmentApi,
  publicApi,
  accountApi,
} from '@footy-finder/api-client';

export const apiClient = new ApiClient(import.meta.env.VITE_API_URL ?? 'http://localhost:3000');
export const authClient = authApi(apiClient);
export const usersClient = usersApi(apiClient);
export const matchClient = matchesApi(apiClient);
export const walletClient = walletApi(apiClient);
export const messagingClient = messagingApi(apiClient);
export const notificationsClient = notificationsApi(apiClient);
export const teamsClient = teamsApi(apiClient);
export const teamWalletClient = teamWalletApi(apiClient);
export const teamChatClient = teamChatApi(apiClient);
export const supportClient = supportApi(apiClient);
export const bookingsClient = bookingsApi(apiClient);
export const moderationClient = moderationApi(apiClient);
export const disputesClient = disputesApi(apiClient);
export const onboardingClient = onboardingApi(apiClient);
export const venuesClient = venuesApi(apiClient);
export const refereeClient = refereeApi(apiClient);
export const teamReviewsClient = teamReviewsApi(apiClient);
export const socialClient = socialApi(apiClient);
export const recruitmentClient = recruitmentApi(apiClient);
export const publicClient = publicApi(apiClient);
export const accountClient = accountApi(apiClient);
