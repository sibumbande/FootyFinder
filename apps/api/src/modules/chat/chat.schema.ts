import { z } from 'zod';
export const sendMessageSchema = z.object({
  matchId: z.string().uuid(),
  content: z.string().min(1).max(2000),
});
