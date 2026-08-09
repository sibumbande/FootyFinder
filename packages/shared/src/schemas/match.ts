import { z } from 'zod';
export const createMatchSchema = z.object({ name: z.string().min(3).max(120), description: z.string().max(1000).optional(), venueName: z.string().min(2).max(160), address: z.string().max(300).optional(), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(), startsAt: z.string().datetime(), maxPlayers: z.number().int().min(2).max(100) });
export const updateMatchSchema = createMatchSchema.partial();
export type CreateMatchInput = z.infer<typeof createMatchSchema>;
