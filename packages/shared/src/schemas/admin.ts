import { z } from 'zod';

export const adminMfaCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
export type AdminMfaCodeInput = z.infer<typeof adminMfaCodeSchema>;
