import { z } from 'zod';

export const moderationReportTargetTypeSchema = z.enum([
  'USER',
  'DIRECT_MESSAGE',
  'LOBBY_MESSAGE',
  'TEAM',
  'MATCH',
]);
export const moderationReportReasonSchema = z.enum([
  'HARASSMENT',
  'ABUSE',
  'CHEATING',
  'SPAM',
  'IMPERSONATION',
  'SAFETY',
  'OTHER',
]);
export const moderationReportStatusSchema = z.enum([
  'OPEN',
  'UNDER_REVIEW',
  'RESOLVED',
  'DISMISSED',
]);

export const createModerationReportSchema = z.object({
  targetType: moderationReportTargetTypeSchema,
  targetId: z.string().uuid(),
  reason: moderationReportReasonSchema,
  details: z.string().trim().min(3).max(2000).optional(),
});

export const adminModerationReportQuerySchema = z.object({
  status: moderationReportStatusSchema.optional(),
  targetType: moderationReportTargetTypeSchema.optional(),
  assignedToMe: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
});

export const updateModerationReportSchema = z
  .object({
    status: moderationReportStatusSchema,
    assignedToMe: z.boolean().optional(),
    resolutionSummary: z.string().trim().min(3).max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    if (['RESOLVED', 'DISMISSED'].includes(value.status) && !value.resolutionSummary) {
      ctx.addIssue({ code: 'custom', path: ['resolutionSummary'], message: 'A resolution summary is required.' });
    }
  });

export const adminModerationUserQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  accountStatus: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED']).optional(),
});

export const createAccountEnforcementSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('SUSPENSION'),
    publicReason: z.string().trim().min(3).max(500),
    internalNote: z.string().trim().max(2000).optional(),
    endsAt: z.string().datetime(),
  }).strict(),
  z.object({
    type: z.literal('BAN'),
    publicReason: z.string().trim().min(3).max(500),
    internalNote: z.string().trim().max(2000).optional(),
  }).strict(),
]);

export const revokeAccountEnforcementSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export type CreateModerationReportInput = z.infer<typeof createModerationReportSchema>;
export type AdminModerationReportQuery = z.infer<typeof adminModerationReportQuerySchema>;
export type UpdateModerationReportInput = z.infer<typeof updateModerationReportSchema>;
export type AdminModerationUserQuery = z.infer<typeof adminModerationUserQuerySchema>;
export type CreateAccountEnforcementInput = z.infer<typeof createAccountEnforcementSchema>;
export type RevokeAccountEnforcementInput = z.infer<typeof revokeAccountEnforcementSchema>;
