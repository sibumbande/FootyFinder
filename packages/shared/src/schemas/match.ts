import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().max(max).transform((value) => value || undefined).optional();

export const createMatchSchema = z.object({
  name: z.string().trim().min(3, 'Match name must be at least 3 characters').max(120),
  description: optionalText(1000),
  venueName: z.string().trim().min(2).max(160),
  address: optionalText(300),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  startsAt: z.string().datetime().refine((value) => new Date(value).getTime() > Date.now(), 'Choose a future date and time'),
});

export const updateMatchSchema = createMatchSchema.partial();
export type CreateMatchInput = z.infer<typeof createMatchSchema>;
export type UpdateMatchInput = z.infer<typeof updateMatchSchema>;
