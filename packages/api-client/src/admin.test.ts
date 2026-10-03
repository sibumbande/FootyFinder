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
    await api.refereeMatches('upcoming');
    await api.refereeOptions('match-id');
    await api.assignReferee('match-id', { refereeUserId: 'user-id' });
    await api.removeReferee('match-id', { reason: 'Unwell' });
    await api.refereeSettings();
    await api.updateRefereeSettings({ defaultRefereeUserId: null });
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/admin/referees',
      '/admin/referees/user-id',
      '/admin/referees/user-id/revoke',
      '/admin/referee-matches?view=upcoming',
      '/admin/matches/match-id/referee-options',
      '/admin/matches/match-id/referee',
      '/admin/matches/match-id/referee/remove',
      '/admin/referee-settings',
      '/admin/referee-settings',
    ]);
    expect(request.mock.calls[5]![1]).toMatchObject({ method: 'PUT' });
    expect(request.mock.calls[8]![1]).toMatchObject({ method: 'PUT' });
    expect(request.mock.calls[1]![1]).toMatchObject({ method: 'POST', body: JSON.stringify({ reason: 'Qualified referee' }) });
    request.mockClear();
    const entry = { result: { outcome: 'ABANDONED' as const, homeScore: 0, awayScore: 0, goals: [], didNotPlayUserIds: [] }, reason: 'Referee did not attend' };
    await api.resultQueue('recent');
    await api.resultDetail('match-id');
    await api.enterResult('match-id', entry);
    await api.correctResult('match-id', entry);
    await api.resultProblems('RESOLVED');
    await api.resolveResultProblem('report-id', 'Checked the footage');
    await api.refereeReport('2026-10-01', '2026-10-31');
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/admin/results?view=recent',
      '/admin/results/match-id',
      '/admin/results/match-id/entry',
      '/admin/results/match-id/correction',
      '/admin/result-problems?status=RESOLVED',
      '/admin/result-problems/report-id/resolve',
      '/admin/referee-report?from=2026-10-01&to=2026-10-31',
    ]);
    expect(request.mock.calls[2]![1]).toMatchObject({ method: 'POST', body: JSON.stringify(entry) });
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
    await api.adminMatches({ view: 'upcoming', needs: 'referee', q: 'Friday' });
    await api.createAdminMatch({
      managedFieldId: '11111111-1111-4111-8111-111111111111',
      name: 'Admin Match',
      format: 'FIVE_A_SIDE',
      substituteCapacityPerTeam: 5,
      rollingSubstitutes: true,
      rules: [],
      visibility: 'PUBLIC',
      startsAt: '2026-09-01T18:00:00.000Z',
      freeOnFootyFinder: true,
      firstTimersOnly: true,
    });
    await api.adminMatch('match-id');
    await api.rotateAdminMatchInvite('match-id');
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
      '/admin/matches?view=upcoming&needs=referee&q=Friday',
      '/admin/matches',
      '/admin/matches/match-id',
      '/admin/matches/match-id/invite',
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
    await api.paymentDisputes();
    await api.paymentDisputeEvidence('dispute-id');
    await api.liftBookingRestriction('user-id', 'Repaid by EFT');
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/admin/finance/top-ups?status=REVIEW',
      '/admin/finance/top-ups/payment-id/refunds',
      '/admin/finance/refunds/refund-id/retry',
      '/admin/finance/refunds/refund-id/restore',
      '/admin/finance/payment-disputes',
      '/admin/finance/payment-disputes/dispute-id/evidence',
      '/admin/finance/users/user-id/lift-booking-restriction',
    ]);
    expect(request.mock.calls[1]![1]).toMatchObject({ headers: { 'Idempotency-Key': 'key-1' } });
  });
});

describe('adminApi waiting list (CEO batch 3.5, item 4)', () => {
  it('lists with filters and downloads the CSV through the file download', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    const download = vi.fn().mockResolvedValue({ blob: new Blob(['x']), filename: 'waiting-list.csv' });
    const api = adminApi({ request, download } as unknown as ApiClient);
    await api.waitingList();
    await api.waitingList({ cityId: '11111111-1111-4111-8111-111111111111', subscribed: 'yes', page: 2 });
    await api.downloadWaitingList();
    await api.downloadWaitingList('11111111-1111-4111-8111-111111111111');
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/admin/waiting-list',
      '/admin/waiting-list?cityId=11111111-1111-4111-8111-111111111111&subscribed=yes&page=2',
    ]);
    expect(download.mock.calls).toEqual([
      ['/admin/waiting-list.csv', 'waiting-list.csv'],
      ['/admin/waiting-list.csv?cityId=11111111-1111-4111-8111-111111111111', 'waiting-list.csv'],
    ]);
  });
});

describe('adminApi girls-only (CEO batch 4, item 1)', () => {
  it('switches girls-only and corrects a gender', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    const api = adminApi({ request } as unknown as ApiClient);
    await api.setGirlsOnly('match-id', { girlsOnly: true, reason: 'Women only night' });
    await api.correctGender('user-id', { gender: 'FEMALE', reason: 'Player asked support' });
    expect(request.mock.calls.map(([path]) => path)).toEqual(['/admin/matches/match-id/girls-only', '/admin/moderation/users/user-id/gender']);
  });
});

describe('adminApi refunds that need bank details (CEO batch 4, item 3)', () => {
  it('sends the bank details and lists banks', async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    const api = adminApi({ request } as unknown as ApiClient);
    await api.refundBankDetails('refund-id', { bankId: '140', bankName: 'Capitec Bank', accountNumber: '1234567890' });
    await api.paystackBanks();
    expect(request.mock.calls.map(([path]) => path)).toEqual(['/admin/finance/refunds/refund-id/bank-details', '/admin/finance/banks']);
  });
});
