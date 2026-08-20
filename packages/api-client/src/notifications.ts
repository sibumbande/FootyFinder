import type { AppNotification } from '@footy-finder/shared';
import type { ApiClient } from './client.js';
export const notificationsApi = (client: ApiClient) => ({
  list: () => client.request<{ data: AppNotification[] }>('/notifications'),
  markRead: (id: string) =>
    client.request<{ data: { success: true } }>(`/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () =>
    client.request<{ data: { success: true } }>('/notifications/read-all', { method: 'POST' }),
});
