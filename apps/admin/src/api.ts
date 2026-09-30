import { ApiClient, adminApi, authApi, teamReviewsApi, usersApi } from '@footy-finder/api-client';

export const client = new ApiClient(import.meta.env.VITE_API_URL ?? 'http://localhost:3000');
export const authClient = authApi(client);
export const usersClient = usersApi(client);
export const adminClient = adminApi(client);
export const teamReviewsClient = teamReviewsApi(client);
