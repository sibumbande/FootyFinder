import type { PublicUser } from './user.js';

export type SupportTicketCategory = 'GENERAL' | 'ACCOUNT' | 'MATCH' | 'TEAM' | 'PAYMENT' | 'SAFETY';
export type SupportTicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_USER' | 'RESOLVED' | 'CLOSED';
export type SupportTicketPriority = 'NORMAL' | 'HIGH' | 'URGENT';
export interface SupportTicketMessage {
  id: string;
  content: string;
  authorRole: 'USER' | 'ADMIN';
  internal: boolean;
  createdAt: string;
  author: PublicUser;
}
export interface SupportTicket {
  id: string;
  referenceCode: string;
  subject: string;
  category: SupportTicketCategory;
  status: SupportTicketStatus;
  priority: SupportTicketPriority;
  lastMessageAt: string;
  resolvedAt?: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: PublicUser;
  assignedAdmin?: PublicUser;
  messages?: SupportTicketMessage[];
}
