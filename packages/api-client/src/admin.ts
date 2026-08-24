import type {
  AdminAuditEntry,
  AdminAuthStatus,
  AdminMfaCodeInput,
  AdminMfaSetup,
  ManagedFieldAvailabilityInput,
  ManagedFieldExceptionInput,
  ManagedFieldInput,
  ManagedFieldPriceInput,
  ManagedVenue,
  ManagedVenueInput,
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
  venues: () => client.request<{ data: ManagedVenue[] }>('/admin/venues'),
  createVenue: (input: ManagedVenueInput) =>
    client.request<{ data: ManagedVenue }>('/admin/venues', { method: 'POST', body: JSON.stringify(input) }),
  updateVenue: (venueId: string, input: ManagedVenueInput) =>
    client.request<{ data: ManagedVenue }>(`/admin/venues/${venueId}`, { method: 'PUT', body: JSON.stringify(input) }),
  createField: (venueId: string, input: ManagedFieldInput) =>
    client.request<{ data: ManagedVenue }>(`/admin/venues/${venueId}/fields`, { method: 'POST', body: JSON.stringify(input) }),
  updateField: (fieldId: string, input: ManagedFieldInput) =>
    client.request<{ data: ManagedVenue }>(`/admin/fields/${fieldId}`, { method: 'PUT', body: JSON.stringify(input) }),
  replaceFieldAvailability: (fieldId: string, input: ManagedFieldAvailabilityInput) =>
    client.request<{ data: ManagedVenue }>(`/admin/fields/${fieldId}/availability`, { method: 'PUT', body: JSON.stringify(input) }),
  addFieldException: (fieldId: string, input: ManagedFieldExceptionInput) =>
    client.request<{ data: ManagedVenue }>(`/admin/fields/${fieldId}/exceptions`, { method: 'POST', body: JSON.stringify(input) }),
  removeFieldException: (fieldId: string, exceptionId: string) =>
    client.request<{ data: ManagedVenue }>(`/admin/fields/${fieldId}/exceptions/${exceptionId}`, { method: 'DELETE' }),
  addFieldPrice: (fieldId: string, input: ManagedFieldPriceInput) =>
    client.request<{ data: ManagedVenue }>(`/admin/fields/${fieldId}/prices`, { method: 'POST', body: JSON.stringify(input) }),
});
