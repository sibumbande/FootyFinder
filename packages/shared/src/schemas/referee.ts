import { z } from 'zod';

/** Gate 8 / TKT-801 (DEC-020, D25): granting or removing the referee role needs a written reason. */
export const refereeRoleChangeSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type RefereeRoleChangeInput = z.infer<typeof refereeRoleChangeSchema>;

/** Gate 8 / TKT-802: an admin assigns (or changes) a match's referee. */
export const assignRefereeSchema = z.object({
  refereeUserId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500).optional(),
});
export type AssignRefereeInput = z.infer<typeof assignRefereeSchema>;

/** Removing a referee from a match (admin) or declining an assignment (referee, D16). */
export const removeRefereeSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type RemoveRefereeInput = z.infer<typeof removeRefereeSchema>;

export const declineRefereeSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});
export type DeclineRefereeInput = z.infer<typeof declineRefereeSchema>;

/** D28: set or clear the default referee. */
export const refereeSettingsSchema = z.object({
  defaultRefereeUserId: z.string().uuid().nullable(),
});
export type RefereeSettingsInput = z.infer<typeof refereeSettingsSchema>;

export const adminRefereeMatchQuerySchema = z.object({
  view: z.enum(['unassigned', 'upcoming']).default('unassigned'),
});
export type AdminRefereeMatchQuery = z.infer<typeof adminRefereeMatchQuerySchema>;
