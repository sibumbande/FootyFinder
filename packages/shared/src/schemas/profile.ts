import { z } from 'zod';
import { DOMINANT_FEET, FOOTBALL_POSITIONS } from '../types/user.js';

export const updatePlayerProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  bio: z.string().trim().max(500).nullable().optional(),
  preferredPositions: z
    .array(z.enum(FOOTBALL_POSITIONS))
    .max(4)
    .refine((values) => new Set(values).size === values.length, 'Positions must be unique'),
  dominantFoot: z.enum(DOMINANT_FEET).nullable().optional(),
  homeArea: z.string().trim().max(100).nullable().optional(),
});
export type UpdatePlayerProfileInput = z.infer<typeof updatePlayerProfileSchema>;
