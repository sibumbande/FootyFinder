import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './client.js';
import { adminApi } from './admin.js';

describe('adminApi', () => {
  it('uses the Gate 6 venue settlement contracts', async () => {
    const request = vi.fn().mockResolvedValue({ data: [] });
    const api = adminApi({ request } as unknown as ApiClient);
    await api.venueBeneficiaries('venue-id');
    await api.approveVenueBeneficiary('beneficiary-id');
    await api.revealVenueBeneficiary('beneficiary-id');
    await api.venuePayables({ status: 'DUE' });
    await api.adjustVenuePayable('payable-id', { amountCents: -1_000, reason: 'Floodlight failure' });
    await api.settlementDue();
    await api.settlementBatches('PREPARED');
    await api.prepareSettlement({ venueId: 'venue-id', weekStart: '2026-10-26' });
    await api.approveSettlement('batch-id');
    await api.markSettlementPaid('batch-id', { payoutReference: 'EFT-1', evidenceNote: 'Bank confirmation 1' });
    await api.cancelSettlement('batch-id', 'Wrong week selected');
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/admin/venues/venue-id/beneficiaries',
      '/admin/beneficiaries/beneficiary-id/approve',
      '/admin/beneficiaries/beneficiary-id/reveal',
      '/admin/settlement/payables?status=DUE',
      '/admin/settlement/payables/payable-id/adjustments',
      '/admin/settlement/due',
      '/admin/settlement/batches?status=PREPARED',
      '/admin/settlement/batches',
      '/admin/settlement/batches/batch-id/approve',
      '/admin/settlement/batches/batch-id/mark-paid',
      '/admin/settlement/batches/batch-id/cancel',
    ]);
    expect(request.mock.calls[2]![1]).toMatchObject({ method: 'POST' });
  });

  it('uses the Gate 8 referee role contracts', async () => {
    const request = vi.fn().mockResolvedValue({ data: [] });
    const api = adminApi({ request } as unknown as ApiClient);
    await api.referees();
    await api.grantReferee('user-id', { reason: 'Qualified referee' });
    await api.revokeReferee('user-id', { reason: 'Stepped down' });
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/admin/referees',
      '/admin/referees/user-id',
      '/admin/referees/user-id/revoke',
    ]);
    expect(request.mock.calls[1]![1]).toMatchObject({ method: 'POST', body: JSON.stringify({ reason: 'Qualified referee' }) });
  });

  it('uses distinct pre-MFA and privileged Admin routes', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    const api = adminApi({ request } as unknown as ApiClient);
    await api.authStatus();
    await api.setupMfa();
    await api.verifyMfa({ code: '123456' });
    await api.auditLog();
    expect(request).toHaveBeenNthCalledWith(1, '/admin/auth/status');
    expect(request).toHaveBeenNthCalledWith(2, '/admin/auth/mfa/setup', { method: 'POST' });
    expect(request).toHaveBeenNthCalledWith(3, '/admin/auth/mfa/verify', {
      method: 'POST',
      body: JSON.stringify({ code: '123456' }),
    });
    expect(request).toHaveBeenNthCalledWith(4, '/admin/audit-logs');
  });

  it('reads the privileged operations summary', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    const api = adminApi({ request } as unknown as ApiClient);
    await api.operationsSummary();
    expect(request).toHaveBeenCalledWith('/admin/operations/summary');
  });

  it('uses the managed venue, field, schedule, exception, and price contracts', async () => {
    const request = vi.fn().mockResolvedValue({ data: [] });
    const api = adminApi({ request } as unknown as ApiClient);
    const venue = {
      name: 'Central',
      addressLine1: '1 Main Road',
      city: 'Cape Town',
      region: 'Western Cape',
      countryCode: 'ZA',
      timezone: 'Africa/Johannesburg',
      isActive: true,
    };
    const field = {
      name: 'Court A',
      status: 'ACTIVE' as const,
      supportedFormats: ['FIVE_A_SIDE' as const],
    };
    await api.venues();
    await api.createVenue(venue);
    await api.updateVenue('venue-id', venue);
    await api.createField('venue-id', field);
    await api.updateField('field-id', field);
    await api.replaceFieldAvailability('field-id', { periods: [] });
    await api.addFieldException('field-id', {
      startsAt: '2026-09-01T08:00:00.000Z',
      endsAt: '2026-09-01T10:00:00.000Z',
      available: false,
    });
    await api.removeFieldException('field-id', 'exception-id');
    await api.addFieldPrice('field-id', {
      amountCents: 80000,
      effectiveFrom: '2026-09-01T00:00:00.000Z',
    });
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/admin/venues',
      '/admin/venues',
      '/admin/venues/venue-id',
      '/admin/venues/venue-id/fields',
      '/admin/fields/field-id',
      '/admin/fields/field-id/availability',
      '/admin/fields/field-id/exceptions',
      '/admin/fields/field-id/exceptions/exception-id',
      '/admin/fields/field-id/prices',
    ]);
    expect(request).toHaveBeenLastCalledWith('/admin/fields/field-id/prices', {
      method: 'POST',
      body: JSON.stringify({ amountCents: 80000, effectiveFrom: '2026-09-01T00:00:00.000Z' }),
    });
  });

  it('uses privileged support and environment-gated test-data contracts', async () => {
    const request = vi.fn().mockResolvedValue({ data: [] });
    const api = adminApi({ request } as unknown as ApiClient);
    await api.supportTickets({ status: 'OPEN', assignedToMe: true });
    await api.supportTicket('ticket-id');
    await api.replySupportTicket('ticket-id', { content: 'We can help.', internal: false });
    await api.updateSupportTicket('ticket-id', { priority: 'HIGH' });
    await api.testDataStatus();
    await api.testDataBatches();
    await api.createTestDataBatch({ label: 'QA batch', accountCount: 3 });
    await api.removeTestDataBatch('batch-id');
    await api.walletReconciliation();
    await api.managedMatches();
    await api.createManagedMatch({
      managedFieldId: '11111111-1111-4111-8111-111111111111',
      name: 'Admin Match',
      format: 'FIVE_A_SIDE',
      substituteCapacityPerTeam: 5,
      rollingSubstitutes: true,
      rules: [],
      visibility: 'PUBLIC',
      startsAt: '2026-09-01T18:00:00.000Z',
    });
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/admin/support/tickets?status=OPEN&assignedToMe=true',
      '/admin/support/tickets/ticket-id',
      '/admin/support/tickets/ticket-id/messages',
      '/admin/support/tickets/ticket-id',
      '/admin/test-data/status',
      '/admin/test-data/batches',
      '/admin/test-data/batches',
      '/admin/test-data/batches/batch-id',
      '/admin/finance/reconciliation',
      '/admin/matches',
      '/admin/matches',
    ]);
  });

  it('uses moderation report and account enforcement contracts', async () => {
    const request = vi.fn().mockResolvedValue({ data: [] });
    const api = adminApi({ request } as unknown as ApiClient);
    await api.moderationReports({ status: 'OPEN', targetType: 'USER', assignedToMe: true });
    await api.moderationReport('report-id');
    await api.updateModerationReport('report-id', {
      status: 'RESOLVED',
      resolutionSummary: 'Reviewed.',
    });
    await api.moderationUsers({ search: 'player', accountStatus: 'SUSPENDED' });
    await api.moderationUser('user-id');
    await api.enforceUser('user-id', {
      type: 'SUSPENSION',
      publicReason: 'Safety review.',
      endsAt: '2026-09-01T18:00:00.000Z',
    });
    await api.revokeEnforcement('user-id', 'enforcement-id', { reason: 'Review complete.' });
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/admin/moderation/reports?status=OPEN&targetType=USER&assignedToMe=true',
      '/admin/moderation/reports/report-id',
      '/admin/moderation/reports/report-id',
      '/admin/moderation/users?search=player&accountStatus=SUSPENDED',
      '/admin/moderation/users/user-id',
      '/admin/moderation/users/user-id/enforcements',
      '/admin/moderation/users/user-id/enforcements/enforcement-id/revoke',
    ]);
  });

  it('uses dispute review and authoritative resolution contracts', async () => {
    const request = vi.fn().mockResolvedValue({ data: [] });
    const api = adminApi({ request } as unknown as ApiClient);
    await api.disputes({ status: 'OPEN', type: 'MATCH_RESULT', assignedToMe: true });
    await api.dispute('dispute-id');
    await api.reviewDispute('dispute-id', { assignedToMe: true });
    await api.resolveDispute('dispute-id', {
      outcome: 'RESULT_CONFIRMED',
      resolutionSummary: 'Evidence confirms the original result.',
    });
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/admin/disputes?status=OPEN&type=MATCH_RESULT&assignedToMe=true',
      '/admin/disputes/dispute-id',
      '/admin/disputes/dispute-id/review',
      '/admin/disputes/dispute-id/resolve',
    ]);
  });

  it('uses the Gate 6 finance contracts', async () => {
    const request = vi.fn().mockResolvedValue({ data: [] });
    const api = adminApi({ request } as unknown as ApiClient);
    await api.topUps({ status: 'REVIEW' });
    await api.refundTopUp('payment-id', { amountCents: 5_000, reason: 'Charged twice' }, 'key-1');
    await api.retryRefund('refund-id');
    await api.restoreRefund('refund-id', 'Card closed by bank');
    await api.restrictedWallets();
    await api.liftRestriction('user-id', 'Repaid by EFT');
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/admin/finance/top-ups?status=REVIEW',
      '/admin/finance/top-ups/payment-id/refunds',
      '/admin/finance/refunds/refund-id/retry',
      '/admin/finance/refunds/refund-id/restore',
      '/admin/finance/restricted-wallets',
      '/admin/finance/wallets/user-id/lift-restriction',
    ]);
    expect(request.mock.calls[1]![1]).toMatchObject({ headers: { 'Idempotency-Key': 'key-1' } });
  });
});
