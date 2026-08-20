import type { PublicUser } from './user.js';
export interface DirectMessage {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: string;
  editedAt?: string | null;
  deletedAt?: string | null;
  sender?: PublicUser;
}
export interface Conversation {
  id: string;
  otherParticipant: PublicUser;
  latestMessage?: DirectMessage | null;
  unread: boolean;
  updatedAt: string;
  messages?: DirectMessage[];
}
