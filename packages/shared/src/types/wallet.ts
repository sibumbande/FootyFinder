import type { AuthenticatedUser } from './user.js';

export const MATCH_FEE_CENTS = 8_000;
export const DEMO_DEPOSIT_CENTS = 50_000;

export type DepositStatus = 'success' | 'failure' | 'error';

export interface DepositResponse {
  status: DepositStatus;
  transactionId: string;
  user?: AuthenticatedUser;
  message?: string;
  replayed?: boolean;
}
