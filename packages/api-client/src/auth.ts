import type { AuthenticatedUser, LoginInput, RegisterInput } from '@footy-finder/shared';
import type { ApiClient } from './client.js';
export const authApi = (client: ApiClient) => ({
  register: (input: RegisterInput) =>
    client.request<{ data: AuthenticatedUser }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  login: (input: LoginInput) =>
    client.request<{ data: AuthenticatedUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  logout: () => client.request<{ data: { success: true } }>('/auth/logout', { method: 'POST' }),
});
