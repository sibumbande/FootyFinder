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

/** Gate 8 / TKT-807: the admin results queue. */
export const adminResultQuerySchema = z.object({
  view: z.enum(['awaiting', 'recent']).default('awaiting'),
});
export type AdminResultQuery = z.infer<typeof adminResultQuerySchema>;

export const adminResultProblemQuerySchema = z.object({
  status: z.enum(['OPEN', 'RESOLVED']).default('OPEN'),
});
export type AdminResultProblemQuery = z.infer<typeof adminResultProblemQuerySchema>;

/** D6: an admin resolves a problem report with a note the reporter sees. */
export const resolveResultProblemSchema = z.object({
  note: z.string().trim().min(3).max(2000),
});
export type ResolveResultProblemInput = z.infer<typeof resolveResultProblemSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
/** D8: kickoff dates (South African time), inclusive. At most one year. */
export const adminRefereeReportQuerySchema = z
  .object({ from: isoDate, to: isoDate })
  .refine(({ from, to }) => from <= to, { message: 'The start date must be on or before the end date.', path: ['to'] })
  .refine(({ from, to }) => Date.parse(to) - Date.parse(from) <= 366 * 86_400_000, { message: 'Choose at most one year.', path: ['to'] });
export type AdminRefereeReportQuery = z.infer<typeof adminRefereeReportQuerySchema>;
