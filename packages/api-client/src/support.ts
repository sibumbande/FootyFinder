import type { CreateSupportTicketInput, SupportReplyInput, SupportTicket } from '@footy-finder/shared';
import type { ApiClient } from './client.js';

export const supportApi = (client: ApiClient) => ({
  list: () => client.request<{ data: SupportTicket[] }>('/support/tickets'),
  create: (input: CreateSupportTicketInput) => client.request<{ data: SupportTicket }>('/support/tickets', { method: 'POST', body: JSON.stringify(input) }),
  get: (ticketId: string) => client.request<{ data: SupportTicket }>(`/support/tickets/${ticketId}`),
  reply: (ticketId: string, input: SupportReplyInput) => client.request<{ data: SupportTicket }>(`/support/tickets/${ticketId}/messages`, { method: 'POST', body: JSON.stringify(input) }),
});
