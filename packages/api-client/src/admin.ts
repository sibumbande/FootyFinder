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
  ManagedVenueMediaInput,
  VenueCancellationPolicyInput,
  AdminSupportListQuery,
  AdminSupportReplyInput,
  UpdateSupportTicketInput,
  SupportTicket,
  AdminTestDataStatus,
  AdminTestDataBatch,
  CreateAdminTestDataBatchInput,
  WalletReconciliationReport,
  AdminFieldBooking,
  ManagedMatchBookingInput,
  ModerationReport,
  AdminModerationReportQuery,
  UpdateModerationReportInput,
  AdminModerationUserQuery,
  ModerationUserSummary,
  CreateAccountEnforcementInput,
  RevokeAccountEnforcementInput,
  PublicUser,
  Dispute,
  AdminDisputeQuery,
  ReviewDisputeInput,
  ResolveDisputeInput,
  OperationsSummary,
  AdminTopUp,
  AdminTopUpStatus,
  AdminCardRefundInput,
  AdminRestrictedWallet,
} from '@footy-finder/shared';
import type { ApiClient } from './client.js';

export const adminApi = (client: ApiClient) => ({
  operationsSummary: () => client.request<{ data: OperationsSummary }>('/admin/operations/summary'),
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
    client.request<{ data: ManagedVenue }>('/admin/venues', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateVenue: (venueId: string, input: ManagedVenueInput) =>
    client.request<{ data: ManagedVenue }>(`/admin/venues/${venueId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  createField: (venueId: string, input: ManagedFieldInput) =>
    client.request<{ data: ManagedVenue }>(`/admin/venues/${venueId}/fields`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateField: (fieldId: string, input: ManagedFieldInput) =>
    client.request<{ data: ManagedVenue }>(`/admin/fields/${fieldId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  replaceFieldAvailability: (fieldId: string, input: ManagedFieldAvailabilityInput) =>
    client.request<{ data: ManagedVenue }>(`/admin/fields/${fieldId}/availability`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  addFieldException: (fieldId: string, input: ManagedFieldExceptionInput) =>
    client.request<{ data: ManagedVenue }>(`/admin/fields/${fieldId}/exceptions`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  removeFieldException: (fieldId: string, exceptionId: string) =>
    client.request<{ data: ManagedVenue }>(`/admin/fields/${fieldId}/exceptions/${exceptionId}`, {
      method: 'DELETE',
    }),
  addFieldPrice: (fieldId: string, input: ManagedFieldPriceInput) =>
    client.request<{ data: ManagedVenue }>(`/admin/fields/${fieldId}/prices`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  replaceVenueMedia: (venueId: string, input: ManagedVenueMediaInput) =>
    client.request<{ data: ManagedVenue }>(`/admin/venues/${venueId}/media`, { method: 'PUT', body: JSON.stringify(input) }),
  addVenueCancellationPolicy: (venueId: string, input: VenueCancellationPolicyInput) =>
    client.request<{ data: ManagedVenue }>(`/admin/venues/${venueId}/cancellation-policies`, { method: 'POST', body: JSON.stringify(input) }),
  submitVenue: (venueId: string) => client.request<{ data: ManagedVenue }>(`/admin/venues/${venueId}/submit`, { method: 'POST' }),
  approveVenue: (venueId: string) => client.request<{ data: ManagedVenue }>(`/admin/venues/${venueId}/approve`, { method: 'POST' }),
  deactivateVenue: (venueId: string, reason: string) => client.request<{ data: ManagedVenue }>(`/admin/venues/${venueId}/deactivate`, { method: 'POST', body: JSON.stringify({ reason }) }),
  supportTickets: (query: AdminSupportListQuery = {}) => {
    const params = new URLSearchParams();
    if (query.status) params.set('status', query.status);
    if (query.priority) params.set('priority', query.priority);
    if (query.assignedToMe !== undefined) params.set('assignedToMe', String(query.assignedToMe));
    const suffix = params.size ? `?${params.toString()}` : '';
    return client.request<{ data: SupportTicket[] }>(`/admin/support/tickets${suffix}`);
  },
  supportTicket: (ticketId: string) =>
    client.request<{ data: SupportTicket }>(`/admin/support/tickets/${ticketId}`),
  replySupportTicket: (ticketId: string, input: AdminSupportReplyInput) =>
    client.request<{ data: SupportTicket }>(`/admin/support/tickets/${ticketId}/messages`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateSupportTicket: (ticketId: string, input: UpdateSupportTicketInput) =>
    client.request<{ data: SupportTicket }>(`/admin/support/tickets/${ticketId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  testDataStatus: () => client.request<{ data: AdminTestDataStatus }>('/admin/test-data/status'),
  testDataBatches: () => client.request<{ data: AdminTestDataBatch[] }>('/admin/test-data/batches'),
  createTestDataBatch: (input: CreateAdminTestDataBatchInput) =>
    client.request<{ data: AdminTestDataBatch }>('/admin/test-data/batches', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  removeTestDataBatch: (batchId: string) =>
    client.request<{ data: { success: true; deletedAccounts: number } }>(
      `/admin/test-data/batches/${batchId}`,
      { method: 'DELETE' },
    ),
  walletReconciliation: () =>
    client.request<{ data: WalletReconciliationReport }>('/admin/finance/reconciliation'),
  // Gate 6 / TKT-606: card top-ups, refunds to card, chargebacks and wallet restrictions.
  topUps: (query: { status?: AdminTopUpStatus; reference?: string } = {}) => {
    const search = new URLSearchParams(Object.entries(query).filter(([, value]) => value) as Array<[string, string]>).toString();
    return client.request<{ data: AdminTopUp[] }>(`/admin/finance/top-ups${search ? `?${search}` : ''}`);
  },
  refundTopUp: (paymentId: string, input: AdminCardRefundInput, idempotencyKey: string) =>
    client.request<{ data: AdminTopUp }>(`/admin/finance/top-ups/${encodeURIComponent(paymentId)}/refunds`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(input),
    }),
  retryRefund: (refundId: string) =>
    client.request<{ data: AdminTopUp }>(`/admin/finance/refunds/${encodeURIComponent(refundId)}/retry`, { method: 'POST' }),
  restoreRefund: (refundId: string, reason: string) =>
    client.request<{ data: AdminTopUp }>(`/admin/finance/refunds/${encodeURIComponent(refundId)}/restore`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  restrictedWallets: () => client.request<{ data: AdminRestrictedWallet[] }>('/admin/finance/restricted-wallets'),
  liftRestriction: (userId: string, reason: string) =>
    client.request<{ data: { changed: boolean } }>(`/admin/finance/wallets/${encodeURIComponent(userId)}/lift-restriction`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  managedMatches: () => client.request<{ data: AdminFieldBooking[] }>('/admin/matches'),
  createManagedMatch: (input: ManagedMatchBookingInput) =>
    client.request<{ data: AdminFieldBooking }>('/admin/matches', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  moderationReports: (query: AdminModerationReportQuery = {}) => {
    const params = new URLSearchParams();
    if (query.status) params.set('status', query.status);
    if (query.targetType) params.set('targetType', query.targetType);
    if (query.assignedToMe !== undefined) params.set('assignedToMe', String(query.assignedToMe));
    const suffix = params.size ? `?${params.toString()}` : '';
    return client.request<{ data: ModerationReport[] }>(`/admin/moderation/reports${suffix}`);
  },
  moderationReport: (reportId: string) =>
    client.request<{ data: ModerationReport }>(`/admin/moderation/reports/${reportId}`),
  updateModerationReport: (reportId: string, input: UpdateModerationReportInput) =>
    client.request<{ data: ModerationReport }>(`/admin/moderation/reports/${reportId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  moderationUsers: (query: AdminModerationUserQuery = {}) => {
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.accountStatus) params.set('accountStatus', query.accountStatus);
    const suffix = params.size ? `?${params.toString()}` : '';
    return client.request<{
      data: Array<
        PublicUser & {
          email: string;
          accountStatus: 'ACTIVE' | 'SUSPENDED' | 'BANNED';
          platformRole: 'USER' | 'ADMIN';
        }
      >;
    }>(`/admin/moderation/users${suffix}`);
  },
  moderationUser: (userId: string) =>
    client.request<{ data: ModerationUserSummary }>(`/admin/moderation/users/${userId}`),
  enforceUser: (userId: string, input: CreateAccountEnforcementInput) =>
    client.request<{ data: ModerationUserSummary }>(
      `/admin/moderation/users/${userId}/enforcements`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  revokeEnforcement: (
    userId: string,
    enforcementId: string,
    input: RevokeAccountEnforcementInput,
  ) =>
    client.request<{ data: ModerationUserSummary }>(
      `/admin/moderation/users/${userId}/enforcements/${enforcementId}/revoke`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  disputes: (query: AdminDisputeQuery = {}) => {
    const params = new URLSearchParams();
    if (query.status) params.set('status', query.status);
    if (query.type) params.set('type', query.type);
    if (query.assignedToMe !== undefined) params.set('assignedToMe', String(query.assignedToMe));
    const suffix = params.size ? `?${params.toString()}` : '';
    return client.request<{ data: Dispute[] }>(`/admin/disputes${suffix}`);
  },
  dispute: (disputeId: string) => client.request<{ data: Dispute }>(`/admin/disputes/${disputeId}`),
  reviewDispute: (disputeId: string, input: ReviewDisputeInput) =>
    client.request<{ data: Dispute }>(`/admin/disputes/${disputeId}/review`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  resolveDispute: (disputeId: string, input: ResolveDisputeInput) =>
    client.request<{ data: Dispute }>(`/admin/disputes/${disputeId}/resolve`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
});
