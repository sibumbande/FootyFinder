import {
  ApiClient,
  authApi,
  matchesApi,
  messagingApi,
  notificationsApi,
  usersApi,
  walletApi,
  teamsApi,
  supportApi,
  bookingsApi,
  moderationApi,
} from '@footy-finder/api-client';

export const apiClient = new ApiClient(import.meta.env.VITE_API_URL ?? 'http://localhost:3000');
export const authClient = authApi(apiClient);
export const usersClient = usersApi(apiClient);
export const matchClient = matchesApi(apiClient);
export const walletClient = walletApi(apiClient);
export const messagingClient = messagingApi(apiClient);
export const notificationsClient = notificationsApi(apiClient);
export const teamsClient = teamsApi(apiClient);
export const supportClient = supportApi(apiClient);
export const bookingsClient = bookingsApi(apiClient);
export const moderationClient = moderationApi(apiClient);
