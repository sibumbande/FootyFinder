import type { PublicUser } from '@footy-finder/shared';
import type { ApiClient } from './client.js';
export const usersApi = (client: ApiClient) => ({
  me: () => client.request<{ data: PublicUser }>('/users/me'),
  list: () => client.request<{ data: PublicUser[] }>('/users'),
});
