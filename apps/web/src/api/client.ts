import { ApiClient, authApi, matchesApi, usersApi } from '@footy-finder/api-client';

export const apiClient = new ApiClient(import.meta.env.VITE_API_URL ?? 'http://localhost:3000');
export const authClient = authApi(apiClient);
export const usersClient = usersApi(apiClient);
export const matchClient = matchesApi(apiClient);
