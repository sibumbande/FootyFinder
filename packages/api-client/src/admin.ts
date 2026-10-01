import type {
  AdminCancelMatchInput,
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
  VenueContentInput,
  VenuePhotoUpload,
  FieldClosureInput,
  FieldClosureResult,
  FieldClosureClash,
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
  AdminVenueBeneficiary,
  AdminVenuePayable,
  AdminSettlementBatch,
  AdminSettlementDue,
  CreateVenueBeneficiaryInput,
  MarkSettlementPaidInput,
  PrepareSettlementInput,
  SettlementBatchStatus,
  VenueBankDetails,
  AdminReferee,
  RefereeRoleChangeInput,
  AdminRefereeMatch,
  AdminRefereeMatchQuery,
  AdminRefereeOption,
  AdminRefereeSettings,
  AssignRefereeInput,
  RemoveRefereeInput,
  RefereeSettingsInput,
  AdminResultQueueItem,
  AdminResultDetail,
  AdminResultEntryInput,
  AdminResultProblem,
  AdminRefereeReportRow,
} from '@footy-finder/shared';
import type { ApiClient } from './client.js';

const post = (body?: unknown) => ({ method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const id = encodeURIComponent;

export const adminApi = (client: ApiClient) => ({
  operationsSummary: () => client.request<{ data: OperationsSummary }>('/admin/operations/summary'),
  // Gate 8 / TKT-801 (DEC-020): the referee role. Grant and revoke need a fresh MFA check.
  referees: () => client.request<{ data: AdminReferee[] }>('/admin/referees'),
  grantReferee: (userId: string, input: RefereeRoleChangeInput) =>
    client.request<{ data: AdminReferee }>(`/admin/referees/${id(userId)}`, post(input)),
  revokeReferee: (userId: string, input: RefereeRoleChangeInput) =>
    client.request<{ data: { userId: string; revoked: true } }>(`/admin/referees/${id(userId)}/revoke`, post(input)),
  // Gate 8 / TKT-802: per-match assignment (D27 busy check) and the default referee (D28, fresh MFA).
  refereeMatches: (view: AdminRefereeMatchQuery['view'] = 'unassigned') =>
    client.request<{ data: AdminRefereeMatch[] }>(`/admin/referee-matches?view=${view}`),
  refereeOptions: (matchId: string) =>
    client.request<{ data: AdminRefereeOption[] }>(`/admin/matches/${id(matchId)}/referee-options`),
  assignReferee: (matchId: string, input: AssignRefereeInput) =>
    client.request<{ data: AdminRefereeMatch }>(`/admin/matches/${id(matchId)}/referee`, { method: 'PUT', body: JSON.stringify(input) }),
  removeReferee: (matchId: string, input: RemoveRefereeInput) =>
    client.request<{ data: AdminRefereeMatch }>(`/admin/matches/${id(matchId)}/referee/remove`, post(input)),
  /** CEO Q4: "Cancel match (weather/venue)" before kick-off (fresh MFA, written reason, audited). */
  cancelMatch: (matchId: string, input: AdminCancelMatchInput) =>
    client.request<{ data: { matchId: string; status: 'CANCELLED'; refundedUserCount: number } }>(
      `/admin/matches/${id(matchId)}/cancel`,
      post(input),
    ),
  refereeSettings: () => client.request<{ data: AdminRefereeSettings }>('/admin/referee-settings'),
  // Gate 8 / TKT-807: results queue, admin entry and correction (fresh MFA), problems, report.
  resultQueue: (view: 'awaiting' | 'recent' = 'awaiting') =>
    client.request<{ data: AdminResultQueueItem[] }>(`/admin/results?view=${view}`),
  resultDetail: (matchId: string) => client.request<{ data: AdminResultDetail }>(`/admin/results/${id(matchId)}`),
  enterResult: (matchId: string, input: AdminResultEntryInput) =>
    client.request<{ data: AdminResultDetail }>(`/admin/results/${id(matchId)}/entry`, post(input)),
  correctResult: (matchId: string, input: AdminResultEntryInput) =>
    client.request<{ data: AdminResultDetail }>(`/admin/results/${id(matchId)}/correction`, post(input)),
  resultProblems: (status: 'OPEN' | 'RESOLVED' = 'OPEN') =>
    client.request<{ data: AdminResultProblem[] }>(`/admin/result-problems?status=${status}`),
  resolveResultProblem: (reportId: string, note: string) =>
    client.request<{ data: AdminResultProblem }>(`/admin/result-problems/${id(reportId)}/resolve`, post({ note })),
  refereeReport: (from: string, to: string) =>
    client.request<{ data: AdminRefereeReportRow[] }>(`/admin/referee-report?from=${from}&to=${to}`),
  updateRefereeSettings: (input: RefereeSettingsInput) =>
    client.request<{ data: AdminRefereeSettings }>('/admin/referee-settings', { method: 'PUT', body: JSON.stringify(input) }),
  // Gate 6 / TKT-607-608: venue bank details, payables and the weekly dual-control queue.
  venueBeneficiaries: (venueId: string) =>
    client.request<{ data: AdminVenueBeneficiary[] }>(`/admin/venues/${id(venueId)}/beneficiaries`),
  createVenueBeneficiary: (venueId: string, input: CreateVenueBeneficiaryInput) =>
    client.request<{ data: AdminVenueBeneficiary }>(`/admin/venues/${id(venueId)}/beneficiaries`, post(input)),
  approveVenueBeneficiary: (beneficiaryId: string) =>
    client.request<{ data: AdminVenueBeneficiary }>(`/admin/beneficiaries/${id(beneficiaryId)}/approve`, post()),
  revealVenueBeneficiary: (beneficiaryId: string) =>
    client.request<{ data: VenueBankDetails }>(`/admin/beneficiaries/${id(beneficiaryId)}/reveal`, post()),
  venuePayables: (query: { status?: AdminVenuePayable['status']; venueId?: string } = {}) => {
    const search = new URLSearchParams(Object.entries(query).filter(([, value]) => value) as Array<[string, string]>).toString();
    return client.request<{ data: AdminVenuePayable[] }>(`/admin/settlement/payables${search ? `?${search}` : ''}`);
  },
  adjustVenuePayable: (payableId: string, input: { amountCents: number; reason: string }) =>
    client.request<{ data: AdminVenuePayable }>(`/admin/settlement/payables/${id(payableId)}/adjustments`, post(input)),
  settlementDue: () => client.request<{ data: AdminSettlementDue[] }>('/admin/settlement/due'),
  settlementBatches: (status?: SettlementBatchStatus) =>
    client.request<{ data: AdminSettlementBatch[] }>(`/admin/settlement/batches${status ? `?status=${status}` : ''}`),
  prepareSettlement: (input: PrepareSettlementInput) =>
    client.request<{ data: AdminSettlementBatch }>('/admin/settlement/batches', post(input)),
  approveSettlement: (batchId: string) =>
    client.request<{ data: AdminSettlementBatch }>(`/admin/settlement/batches/${id(batchId)}/approve`, post()),
  markSettlementPaid: (batchId: string, input: MarkSettlementPaidInput) =>
    client.request<{ data: AdminSettlementBatch }>(`/admin/settlement/batches/${id(batchId)}/mark-paid`, post(input)),
  cancelSettlement: (batchId: string, reason: string) =>
    client.request<{ data: AdminSettlementBatch }>(`/admin/settlement/batches/${id(batchId)}/cancel`, post({ reason })),
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
  /** CEO touch-up batch 3, item 1: uploaded photos; on a live venue the save waits for a second admin (D1). */
  uploadVenuePhoto: (venueId: string, image: File) => {
    const body = new FormData();
    body.append('image', image);
    return client.request<{ data: VenuePhotoUpload }>(`/admin/venues/${venueId}/photos`, { method: 'POST', body });
  },
  saveVenueContent: (venueId: string, input: VenueContentInput) =>
    client.request<{ data: ManagedVenue }>(`/admin/venues/${venueId}/content`, { method: 'PUT', body: JSON.stringify(input) }),
  approveVenueContentChange: (changeId: string) =>
    client.request<{ data: ManagedVenue }>(`/admin/venue-content-changes/${changeId}/approve`, { method: 'POST' }),
  rejectVenueContentChange: (changeId: string, reason: string) =>
    client.request<{ data: ManagedVenue }>(`/admin/venue-content-changes/${changeId}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
  /** CEO touch-up batch 3, item 3: closures go live immediately (fresh MFA, reason, audit). */
  addFieldClosure: (fieldId: string, input: FieldClosureInput) =>
    client.request<{ data: FieldClosureResult }>(`/admin/fields/${fieldId}/closures`, { method: 'POST', body: JSON.stringify(input) }),
  removeFieldClosure: (fieldId: string, closureId: string, reason: string) =>
    client.request<{ data: ManagedVenue }>(`/admin/fields/${fieldId}/closures/${closureId}/remove`, { method: 'POST', body: JSON.stringify({ reason }) }),
  fieldClosureClashes: (fieldId: string) =>
    client.request<{ data: FieldClosureClash[] }>(`/admin/fields/${fieldId}/closure-clashes`),
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
