import { Navigate, Outlet, useSearchParams } from 'react-router-dom';
import { safeReturnTo } from '../utils/return-to.js';
import { useQueryClient } from '@tanstack/react-query';
import { deletionCancelledKey, useAuth } from '../hooks/useAuth.js';
import { AuthLoadingScreen } from './AuthLoadingScreen.js';
export function GuestRoute() {
  const { isPending, isAuthenticated } = useAuth();
  const [search] = useSearchParams();
  const deletionCancelled = useQueryClient().getQueryData<boolean>(deletionCancelledKey);
  if (isPending) return <AuthLoadingScreen />;
  return isAuthenticated ? (
    <Navigate to={deletionCancelled ? '/account/welcome-back' : safeReturnTo(search.get('returnTo'))} replace />
  ) : (
    <Outlet />
  );
}
