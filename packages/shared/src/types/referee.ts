import type { AccountStatus } from './user.js';

/** Gate 8 / DEC-020: a FootyFinder referee as the admin dashboard lists them. Admin-only. */
export interface AdminReferee {
  userId: string;
  displayName: string;
  username: string;
  email: string;
  accountStatus: AccountStatus;
  grantedAt: string;
  grantReason: string;
  grantedBy?: { id: string; displayName: string } | null;
}
