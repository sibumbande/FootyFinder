import { z } from 'zod';
export const startConversationSchema = z.object({ userId: z.string().uuid() });
export const sendDirectMessageSchema = z.object({ content: z.string().trim().min(1).max(2000) });
export const sendLobbyMessageSchema = z.object({ content: z.string().trim().min(1).max(2000) });
export type StartConversationInput = z.infer<typeof startConversationSchema>;
export type SendDirectMessageInput = z.infer<typeof sendDirectMessageSchema>;
export type SendLobbyMessageInput = z.infer<typeof sendLobbyMessageSchema>;
