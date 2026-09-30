import { z } from 'zod';

/** Gate 8 / TKT-801 (DEC-020, D25): granting or removing the referee role needs a written reason. */
export const refereeRoleChangeSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type RefereeRoleChangeInput = z.infer<typeof refereeRoleChangeSchema>;
