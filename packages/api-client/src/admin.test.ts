import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './client.js';
import { adminApi } from './admin.js';

describe('adminApi', () => {
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

  it('uses the managed venue, field, schedule, exception, and price contracts', async () => {
    const request = vi.fn().mockResolvedValue({ data: [] });
    const api = adminApi({ request } as unknown as ApiClient);
    const venue = { name: 'Central', addressLine1: '1 Main Road', city: 'Cape Town', region: 'Western Cape', countryCode: 'ZA', timezone: 'Africa/Johannesburg', isActive: true };
    const field = { name: 'Court A', status: 'ACTIVE' as const, supportedFormats: ['FIVE_A_SIDE' as const] };
    await api.venues();
    await api.createVenue(venue);
    await api.updateVenue('venue-id', venue);
    await api.createField('venue-id', field);
    await api.updateField('field-id', field);
    await api.replaceFieldAvailability('field-id', { periods: [] });
    await api.addFieldException('field-id', { startsAt: '2026-09-01T08:00:00.000Z', endsAt: '2026-09-01T10:00:00.000Z', available: false });
    await api.removeFieldException('field-id', 'exception-id');
    await api.addFieldPrice('field-id', { amountCents: 80000, effectiveFrom: '2026-09-01T00:00:00.000Z' });
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/admin/venues', '/admin/venues', '/admin/venues/venue-id',
      '/admin/venues/venue-id/fields', '/admin/fields/field-id',
      '/admin/fields/field-id/availability', '/admin/fields/field-id/exceptions',
      '/admin/fields/field-id/exceptions/exception-id', '/admin/fields/field-id/prices',
    ]);
    expect(request).toHaveBeenLastCalledWith('/admin/fields/field-id/prices', {
      method: 'POST', body: JSON.stringify({ amountCents: 80000, effectiveFrom: '2026-09-01T00:00:00.000Z' }),
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
    await api.createManagedMatch({ managedFieldId: '11111111-1111-4111-8111-111111111111', name: 'Admin Match', format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 5, rollingSubstitutes: true, rules: [], visibility: 'PUBLIC', startsAt: '2026-09-01T18:00:00.000Z' });
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/admin/support/tickets?status=OPEN&assignedToMe=true',
      '/admin/support/tickets/ticket-id',
      '/admin/support/tickets/ticket-id/messages',
      '/admin/support/tickets/ticket-id',
      '/admin/test-data/status', '/admin/test-data/batches', '/admin/test-data/batches',
      '/admin/test-data/batches/batch-id',
      '/admin/finance/reconciliation',
      '/admin/matches', '/admin/matches',
    ]);
  });
});
