import { afterEach, describe, expect, it, vi } from 'vitest'; import { ApiClient } from './client.js';
afterEach(() => vi.unstubAllGlobals());
describe('ApiClient', () => {
  it('includes credentials for cookie authentication', async () => { const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })); vi.stubGlobal('fetch', fetchMock); await new ApiClient('http://localhost:3000').request('/users/me'); expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/users/me', expect.objectContaining({ credentials: 'include' })); });
  it('surfaces safe API errors', async () => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' }), { status: 401, headers: { 'Content-Type': 'application/json' } }))); await expect(new ApiClient('http://localhost:3000').request('/auth/login')).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' }); });
});
