import type { LoginInput, PublicUser, RegisterInput } from '@footy-finder/shared';
import type { ApiClient } from './client.js';
export const authApi = (client: ApiClient) => ({
  register: (input: RegisterInput) => client.request<{ data: PublicUser }>('/auth/register', { method: 'POST', body: JSON.stringify(input) }),
  login: (input: LoginInput) => client.request<{ data: PublicUser }>('/auth/login', { method: 'POST', body: JSON.stringify(input) }),
  logout: () => client.request<{ data: { success: true } }>('/auth/logout', { method: 'POST' }),
});
