import { z } from 'zod';
import {
  TEAM_CONTRIBUTION_MAX_CENTS,
  TEAM_CONTRIBUTION_MIN_CENTS,
  TEAM_WALLET_HISTORY_DEFAULT_LIMIT,
  TEAM_WALLET_HISTORY_MAX_LIMIT,
} from '../types/team-wallet.js';

const wholeRands = (min: number, max: number, minText: string, maxText: string) =>
  z
    .number({ invalid_type_error: 'Enter an amount in rands.' })
    .int('Enter a whole rand amount.')
    .min(min, minText)
    .max(max, maxText)
    .refine((value) => value % 100 === 0, 'Enter a whole rand amount.');

/** D4: R10 to R5,000 from the member's personal wallet, whole rands only. */
export const teamContributionSchema = z.object({
  amountCents: wholeRands(
    TEAM_CONTRIBUTION_MIN_CENTS,
    TEAM_CONTRIBUTION_MAX_CENTS,
    'The minimum contribution is R10.',
    'The maximum contribution is R5,000.',
  ),
});
export type TeamContributionInput = z.infer<typeof teamContributionSchema>;

/** D8: a member returns some or all of their own unspent contributions to their wallet. */
export const teamContributionRefundSchema = z.object({
  amountCents: wholeRands(100, TEAM_CONTRIBUTION_MAX_CENTS * 100, 'Enter at least R1.', 'That amount is too large.'),
});
export type TeamContributionRefundInput = z.infer<typeof teamContributionRefundSchema>;

export const teamWalletHistoryQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(TEAM_WALLET_HISTORY_MAX_LIMIT)
    .default(TEAM_WALLET_HISTORY_DEFAULT_LIMIT),
});
export type TeamWalletHistoryQuery = z.infer<typeof teamWalletHistoryQuerySchema>;

/** DEC-019 / D3: fill the meter with a whole-rand amount, or omit it to fill what is left. */
export const fillTeamMeterSchema = z.object({
  amountCents: z.number().int().positive().refine((value) => value % 100 === 0, 'Enter a whole rand amount.').optional(),
});
export type FillTeamMeterInput = z.infer<typeof fillTeamMeterSchema>;

/** D5: a team changes its own number of subs (0-10) until the 30-minute check. */
export const changeTeamSubstitutesSchema = z.object({
  substituteCount: z.number().int().min(0).max(10),
});
export type ChangeTeamSubstitutesInput = z.infer<typeof changeTeamSubstitutesSchema>;
