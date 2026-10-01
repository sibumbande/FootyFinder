import { z } from 'zod';
import {
  TOP_UP_MAX_CENTS,
  TOP_UP_MIN_CENTS,
  WALLET_HISTORY_DEFAULT_LIMIT,
  WALLET_HISTORY_MAX_LIMIT,
} from '../types/wallet.js';

export const walletHistoryQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(WALLET_HISTORY_MAX_LIMIT)
    .default(WALLET_HISTORY_DEFAULT_LIMIT),
});
export type WalletHistoryQuery = z.infer<typeof walletHistoryQuerySchema>;

/** DEC-011: whole-rand ZAR top-up from R50 to R5,000, validated on the server. */
export const topUpAmountSchema = z.object({
  amountCents: z
    .number({ invalid_type_error: 'Enter an amount in rands.' })
    .int('Enter a whole rand amount.')
    .min(TOP_UP_MIN_CENTS, 'The minimum top-up is R50.')
    .max(TOP_UP_MAX_CENTS, 'The maximum top-up is R5,000.')
    .refine((value) => value % 100 === 0, 'Enter a whole rand amount.'),
});
export type TopUpAmountInput = z.infer<typeof topUpAmountSchema>;

/** CEO touch-up batch 3, item 6: the large-top-up warning threshold and the undo request. */
export const TOP_UP_LARGE_WARNING_CENTS = 50_000;
export const topUpUndoSchema = z.object({ amountCents: z.number().int().positive().max(500_000) });
