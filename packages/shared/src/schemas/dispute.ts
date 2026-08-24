import { z } from 'zod';
import { resultInputSchema } from './match.js';

export const disputeTypeSchema = z.enum(['MATCH_RESULT', 'FIELD_BOOKING']);
export const disputeReasonSchema = z.enum([
  'INCORRECT_SCORE',
  'INCORRECT_SCORERS',
  'FIELD_UNAVAILABLE',
  'FIELD_QUALITY',
  'BOOKING_SERVICE',
  'PAYMENT',
  'OTHER',
]);
export const disputeStatusSchema = z.enum(['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED']);

export const createDisputeSchema = z.object({
  type: disputeTypeSchema,
  referenceId: z.string().uuid(),
  reason: disputeReasonSchema,
  details: z.string().trim().min(10).max(3000),
}).superRefine((value, ctx) => {
  const resultReasons = ['INCORRECT_SCORE', 'INCORRECT_SCORERS', 'OTHER'];
  if (value.type === 'MATCH_RESULT' && !resultReasons.includes(value.reason))
    ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Reason does not apply to a Match result.' });
  if (value.type === 'FIELD_BOOKING' && ['INCORRECT_SCORE', 'INCORRECT_SCORERS'].includes(value.reason))
    ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Reason does not apply to a field booking.' });
});

export const adminDisputeQuerySchema = z.object({
  status: disputeStatusSchema.optional(),
  type: disputeTypeSchema.optional(),
  assignedToMe: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
});

export const reviewDisputeSchema = z.object({
  assignedToMe: z.boolean().default(true),
});

export const resolveDisputeSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('RESULT_CONFIRMED'), resolutionSummary: z.string().trim().min(10).max(3000) }).strict(),
  z.object({ outcome: z.literal('RESULT_CORRECTED'), resolutionSummary: z.string().trim().min(10).max(3000), correctedResult: resultInputSchema }).strict(),
  z.object({ outcome: z.literal('BOOKING_UPHELD'), resolutionSummary: z.string().trim().min(10).max(3000) }).strict(),
  z.object({ outcome: z.literal('BOOKING_REJECTED'), resolutionSummary: z.string().trim().min(10).max(3000) }).strict(),
]);

export type CreateDisputeInput = z.infer<typeof createDisputeSchema>;
export type AdminDisputeQuery = z.infer<typeof adminDisputeQuerySchema>;
export type ReviewDisputeInput = z.infer<typeof reviewDisputeSchema>;
export type ResolveDisputeInput = z.infer<typeof resolveDisputeSchema>;
