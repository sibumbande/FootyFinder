import { z } from 'zod';

/** Gate 9 / TKT-901: Discover search by display name or username (at least 2 characters). */
export const socialSearchQuerySchema = z.object({
  q: z.string().trim().max(60).optional().transform((value) => value || undefined),
  cityId: z.string().uuid().optional(),
});
export type SocialSearchQuery = z.infer<typeof socialSearchQuerySchema>;

export const relationshipsQuerySchema = z.object({
  userIds: z
    .string()
    .transform((value) => [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))])
    .pipe(z.array(z.string().uuid()).min(1).max(100)),
});

export const sendFriendRequestSchema = z.object({ userId: z.string().uuid() });
export type SendFriendRequestInput = z.infer<typeof sendFriendRequestSchema>;

export const socialSettingsSchema = z.object({ friendRequestsEnabled: z.boolean() });
export type SocialSettingsInput = z.infer<typeof socialSettingsSchema>;

/** Gate 9 / TKT-903. */
export const blockUserSchema = z.object({ userId: z.string().uuid() });

/** Gate 9 / TKT-904 (D11): invite one player to a Team. */
export const createTeamMemberInviteSchema = z.object({
  userId: z.string().uuid(),
  source: z.enum(['FRIEND', 'LOOKING']).default('FRIEND'),
});
export type CreateTeamMemberInviteInput = z.infer<typeof createTeamMemberInviteSchema>;
