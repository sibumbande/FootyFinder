import { z } from 'zod';

/** CEO batch 5, item 1: confirm with the current password and by typing DELETE. */
export const confirmAccountDeletionSchema = z.object({
  password: z.string().min(1, 'Enter your password').max(256),
  confirmation: z.literal('DELETE', { errorMap: () => ({ message: 'Type DELETE to confirm' }) }),
});
export type ConfirmAccountDeletionInput = z.infer<typeof confirmAccountDeletionSchema>;

/** CEO batch 5, item 5: the data download re-checks the password. */
export const dataExportSchema = z.object({
  password: z.string().min(1, 'Enter your password').max(256),
});
export type DataExportInput = z.infer<typeof dataExportSchema>;

/** CEO batch 5, item 4: an admin switches one retention category between a dry run and purging. */
export const setRetentionModeSchema = z.object({ mode: z.enum(['REPORT', 'APPLY']) });
export type SetRetentionModeInput = z.infer<typeof setRetentionModeSchema>;
