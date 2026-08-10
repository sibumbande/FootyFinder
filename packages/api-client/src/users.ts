import type { AuthenticatedUser, PublicUser } from '@footy-finder/shared';
import type { ApiClient } from './client.js';
export const usersApi = (client: ApiClient) => ({
  me: () => client.request<{ data: AuthenticatedUser }>('/users/me'),
  list: () => client.request<{ data: PublicUser[] }>('/users'),
});
