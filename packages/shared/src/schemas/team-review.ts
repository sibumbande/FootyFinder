import { z } from 'zod';

/** Gate 8 / TKT-809 (DEC-017): one 1-5 rating with optional text for the opposing team. */
export const teamReviewInputSchema = z.object({
  rating: z.number().int().min(1).max(5),
  text: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((text) => (text ? text : undefined)),
});
export type TeamReviewInput = z.input<typeof teamReviewInputSchema>;

export const TEAM_REVIEW_MODERATION_ACTIONS = ['APPROVE_TEXT', 'REJECT_TEXT', 'HIDE', 'RESTORE'] as const;
export const moderateTeamReviewSchema = z.object({
  action: z.enum(TEAM_REVIEW_MODERATION_ACTIONS),
  note: z.string().trim().min(3).max(500).optional(),
});
export type ModerateTeamReviewInput = z.infer<typeof moderateTeamReviewSchema>;

export const adminTeamReviewQuerySchema = z.object({
  queue: z.enum(['pending', 'reported', 'all']).default('pending'),
});
export type AdminTeamReviewQuery = z.infer<typeof adminTeamReviewQuerySchema>;

/** DEC-017: an average is shown only once a team has this many visible reviews. */
export const TEAM_REVIEW_MINIMUM_FOR_AVERAGE = 3;
/** DEC-017 / D24: authors may edit for this many days after the final result. */
export const TEAM_REVIEW_EDIT_DAYS = 7;
/** Gate 8 follow-up (CEO, 2026-09-30): a review can be left for this many days after the final result. */
export const TEAM_REVIEW_WINDOW_DAYS = 14;
