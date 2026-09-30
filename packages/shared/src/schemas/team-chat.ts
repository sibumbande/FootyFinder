import { z } from 'zod';
import {
  TEAM_CHAT_MESSAGE_MAX_LENGTH,
  TEAM_CHAT_PAGE_DEFAULT_LIMIT,
  TEAM_CHAT_PAGE_MAX_LIMIT,
} from '../types/team-chat.js';

export const sendTeamChatMessageSchema = z.object({
  content: z.string().trim().min(1, 'Write a message.').max(TEAM_CHAT_MESSAGE_MAX_LENGTH),
});
export type SendTeamChatMessageInput = z.infer<typeof sendTeamChatMessageSchema>;

export const teamChatQuerySchema = z.object({
  before: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(TEAM_CHAT_PAGE_MAX_LIMIT).default(TEAM_CHAT_PAGE_DEFAULT_LIMIT),
});
export type TeamChatQuery = z.infer<typeof teamChatQuerySchema>;
