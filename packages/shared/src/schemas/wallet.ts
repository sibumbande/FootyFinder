import { z } from 'zod';
import { WALLET_HISTORY_DEFAULT_LIMIT, WALLET_HISTORY_MAX_LIMIT } from '../types/wallet.js';

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
