import type { AuthenticatedUser, PublicUser, UpdatePlayerProfileInput } from '@footy-finder/shared';
import type { ApiClient } from './client.js';
export const usersApi = (client: ApiClient) => ({
  me: () => client.request<{ data: AuthenticatedUser }>('/users/me'),
  list: () => client.request<{ data: PublicUser[] }>('/users'),
  profile: (userId: string) => client.request<{ data: PublicUser }>(`/players/${userId}`),
  updateProfile: (input: UpdatePlayerProfileInput) =>
    client.request<{ data: AuthenticatedUser }>('/players/me/profile', {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
});
