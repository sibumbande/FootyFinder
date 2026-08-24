import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './client.js';
import { disputesApi } from './disputes.js';

describe('disputesApi', () => {
  it('uses player dispute and immutable revision contracts', async () => {
    const request = vi.fn().mockResolvedValue({ data: [] });
    const api = disputesApi({ request } as unknown as ApiClient);
    await api.list();
    await api.create({ type: 'MATCH_RESULT', referenceId: '11111111-1111-4111-8111-111111111111', reason: 'INCORRECT_SCORE', details: 'The final score was recorded incorrectly.' });
    await api.resultRevisions('result-id');
    expect(request.mock.calls.map(([path]) => path)).toEqual(['/disputes', '/disputes', '/disputes/results/result-id/revisions']);
  });
});
