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
  AdminSupportListQuery,
  AdminSupportReplyInput,
  UpdateSupportTicketInput,
  SupportTicket,
  AdminTestDataStatus,
  AdminTestDataBatch,
  CreateAdminTestDataBatchInput,
  WalletReconciliationReport,
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
  supportTickets: (query: AdminSupportListQuery = {}) => {
    const params = new URLSearchParams();
    if (query.status) params.set('status', query.status);
    if (query.priority) params.set('priority', query.priority);
    if (query.assignedToMe !== undefined) params.set('assignedToMe', String(query.assignedToMe));
    const suffix = params.size ? `?${params.toString()}` : '';
    return client.request<{ data: SupportTicket[] }>(`/admin/support/tickets${suffix}`);
  },
  supportTicket: (ticketId: string) => client.request<{ data: SupportTicket }>(`/admin/support/tickets/${ticketId}`),
  replySupportTicket: (ticketId: string, input: AdminSupportReplyInput) => client.request<{ data: SupportTicket }>(`/admin/support/tickets/${ticketId}/messages`, { method: 'POST', body: JSON.stringify(input) }),
  updateSupportTicket: (ticketId: string, input: UpdateSupportTicketInput) => client.request<{ data: SupportTicket }>(`/admin/support/tickets/${ticketId}`, { method: 'PUT', body: JSON.stringify(input) }),
  testDataStatus: () => client.request<{ data: AdminTestDataStatus }>('/admin/test-data/status'),
  testDataBatches: () => client.request<{ data: AdminTestDataBatch[] }>('/admin/test-data/batches'),
  createTestDataBatch: (input: CreateAdminTestDataBatchInput) => client.request<{ data: AdminTestDataBatch }>('/admin/test-data/batches', { method: 'POST', body: JSON.stringify(input) }),
  removeTestDataBatch: (batchId: string) => client.request<{ data: { success: true; deletedAccounts: number } }>(`/admin/test-data/batches/${batchId}`, { method: 'DELETE' }),
  walletReconciliation: () => client.request<{ data: WalletReconciliationReport }>('/admin/finance/reconciliation'),
});
