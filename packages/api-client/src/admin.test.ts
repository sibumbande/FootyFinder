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
});
