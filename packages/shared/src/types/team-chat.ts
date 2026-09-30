import type { PublicUser } from './user.js';

/**
 * Gate 7 / TKT-710: one permanent team-owned conversation. Current members read the retained
 * history and send messages; removed members lose all access. Chat never sends email.
 */
export const TEAM_CHAT_PAGE_DEFAULT_LIMIT = 30;
export const TEAM_CHAT_PAGE_MAX_LIMIT = 100;
export const TEAM_CHAT_MESSAGE_MAX_LENGTH = 2000;

export interface TeamChatMessage {
  id: string;
  teamId: string;
  senderId: string;
  content: string;
  createdAt: string;
  sender: PublicUser;
}

export interface TeamChatPage {
  /** Oldest first within the page. */
  messages: TeamChatMessage[];
  /** Cursor for the next older page, or null at the start of the history. */
  olderCursor: string | null;
  /** Messages from others since the viewer last read the chat. */
  unreadCount: number;
}
