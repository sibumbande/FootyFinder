import type { CreateModerationReportInput, ModerationReport } from '@footy-finder/shared';
import type { ApiClient } from './client.js';

export const moderationApi = (client: ApiClient) => ({
  reports: () => client.request<{ data: ModerationReport[] }>('/moderation/reports'),
  createReport: (input: CreateModerationReportInput) =>
    client.request<{ data: ModerationReport }>('/moderation/reports', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
});
