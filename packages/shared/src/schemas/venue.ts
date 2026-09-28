import { z } from 'zod';
import { MATCH_FORMATS } from '../config/match-formats.js';

export const venueSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100);
export const venueSlotsQuerySchema = z.object({
  fieldId: z.string().uuid(),
  format: z.enum(MATCH_FORMATS),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).refine((value) => value.dateFrom <= value.dateTo, { path: ['dateTo'], message: 'End date must not precede start date.' });
export type VenueSlotsQuery = z.infer<typeof venueSlotsQuerySchema>;
