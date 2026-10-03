import { registerDurableJobHandler } from './durable-jobs.js';

/**
 * Job types whose features were retired. Jobs queued before the change finish without doing anything.
 * - DEC-018: pooled player booking funding and the host's venue guarantee.
 * - DEC-021: the wallet (hold expiry) and wallet top-ups (Paystack top-up expiry).
 */
export const RETIRED_JOB_TYPES = [
  'RESERVATION_FUNDING_EXPIRE',
  'QUICK_MATCH_GUARANTEE_SETTLE',
  'WALLET_HOLD_EXPIRE',
  'PAYSTACK_TOP_UP_EXPIRE',
] as const;

export const registerRetiredJobHandlers = () => {
  for (const type of RETIRED_JOB_TYPES) registerDurableJobHandler(type, async () => undefined);
};
