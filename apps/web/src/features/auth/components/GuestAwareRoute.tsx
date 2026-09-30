import { Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { AuthLoadingScreen } from './AuthLoadingScreen.js';
import { ProtectedRoute } from './ProtectedRoute.js';

/**
 * Gate 9 / TKT-910: pages anyone may browse. Guests see the read-only page; signed-in players get
 * the same checks as every protected page (verified email, finished profile).
 */
export function GuestAwareRoute() {
  const { isPending, isAuthenticated } = useAuth();
  if (isPending) return <AuthLoadingScreen />;
  return isAuthenticated ? <ProtectedRoute /> : <Outlet />;
}
