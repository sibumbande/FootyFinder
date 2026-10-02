import type {
  AuthenticatedUser,
  LoginInput,
  RegisterInput,
  RequestEmailChangeInput,
  RequestPasswordResetInput,
  ResetPasswordInput,
  VerificationTokenInput,
} from '@footy-finder/shared';
import type { ApiClient } from './client.js';
export const authApi = (client: ApiClient) => ({
  register: (input: RegisterInput) =>
    client.request<{ data: AuthenticatedUser }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  login: (input: LoginInput) =>
    client.request<{ data: AuthenticatedUser; deletionCancelled?: boolean }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  logout: () => client.request<{ data: { success: true } }>('/auth/logout', { method: 'POST' }),
  resendVerification: () => client.request<{ data: { sent: boolean; alreadyVerified: boolean } }>('/auth/email/verification/resend', { method: 'POST' }),
  verifyEmail: (input: VerificationTokenInput) => client.request<{ data: { success: true } }>('/auth/email/verify', { method: 'POST', body: JSON.stringify(input) }),
  requestPasswordReset: (input: RequestPasswordResetInput) => client.request<{ data: { success: true } }>('/auth/password/reset/request', { method: 'POST', body: JSON.stringify(input) }),
  resetPassword: (input: ResetPasswordInput) => client.request<{ data: { success: true } }>('/auth/password/reset', { method: 'POST', body: JSON.stringify(input) }),
  requestEmailChange: (input: RequestEmailChangeInput) => client.request<{ data: { success: true } }>('/auth/email/change/request', { method: 'POST', body: JSON.stringify(input) }),
  confirmEmailChange: (input: VerificationTokenInput) => client.request<{ data: { success: true } }>('/auth/email/change/confirm', { method: 'POST', body: JSON.stringify(input) }),
});
