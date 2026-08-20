import { Navigate, Outlet, useSearchParams } from 'react-router-dom';
import { safeReturnTo } from '../utils/return-to.js';
import { useAuth } from '../hooks/useAuth.js';
import { AuthLoadingScreen } from './AuthLoadingScreen.js';
export function GuestRoute() {
  const { isPending, isAuthenticated } = useAuth();
  const [search] = useSearchParams();
  if (isPending) return <AuthLoadingScreen />;
  return isAuthenticated ? (
    <Navigate to={safeReturnTo(search.get('returnTo'))} replace />
  ) : (
    <Outlet />
  );
}
