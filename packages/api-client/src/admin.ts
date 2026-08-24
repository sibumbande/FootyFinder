import type {
  AdminAuditEntry,
  AdminAuthStatus,
  AdminMfaCodeInput,
  AdminMfaSetup,
} from '@footy-finder/shared';
import type { ApiClient } from './client.js';

export const adminApi = (client: ApiClient) => ({
  authStatus: () => client.request<{ data: AdminAuthStatus }>('/admin/auth/status'),
  setupMfa: () =>
    client.request<{ data: AdminMfaSetup }>('/admin/auth/mfa/setup', { method: 'POST' }),
  verifyMfa: (input: AdminMfaCodeInput) =>
    client.request<{ data: AdminAuthStatus }>('/admin/auth/mfa/verify', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  auditLog: () => client.request<{ data: AdminAuditEntry[] }>('/admin/audit-logs'),
});
