import type { ReactNode } from 'react';
import { useAuth } from '@/features/auth/hooks/useAuth.js';

/** Gate 9 / TKT-910: the signed-in page for players, the read-only page for guests. */
export function MemberOrGuest({ member, guest }: { member: ReactNode; guest: ReactNode }) {
  const { user } = useAuth();
  return <>{user ? member : guest}</>;
}
