import type { CreateDisputeInput, Dispute, ResultRevision } from '@footy-finder/shared';
import type { ApiClient } from './client.js';

export const disputesApi = (client: ApiClient) => ({
  list: () => client.request<{ data: Dispute[] }>('/disputes'),
  create: (input: CreateDisputeInput) => client.request<{ data: Dispute }>('/disputes', { method: 'POST', body: JSON.stringify(input) }),
  resultRevisions: (resultId: string) => client.request<{ data: ResultRevision[] }>(`/disputes/results/${resultId}/revisions`),
});
