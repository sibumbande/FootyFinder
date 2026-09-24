import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { loginPathFor } from '../utils/return-to.js';
import { AuthLoadingScreen } from './AuthLoadingScreen.js';
export function ProtectedRoute() {
  const { isPending, isAuthenticated } = useAuth();
  const location = useLocation();
  if (isPending) return <AuthLoadingScreen />;
  if (!isAuthenticated) return <Navigate to={loginPathFor(location)} replace />;
  return <Outlet />;
}
