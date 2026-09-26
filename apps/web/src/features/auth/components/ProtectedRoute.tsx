import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { loginPathFor } from '../utils/return-to.js';
import { AuthLoadingScreen } from './AuthLoadingScreen.js';
export function ProtectedRoute() {
  const { isPending, isAuthenticated, user } = useAuth();
  const location = useLocation();
  if (isPending) return <AuthLoadingScreen />;
  if (!isAuthenticated) return <Navigate to={loginPathFor(location)} replace />;
  if (user?.emailVerificationRequired && !user.emailVerified)
    return (
      <Navigate
        to={`/verify-email?returnTo=${encodeURIComponent(`${location.pathname}${location.search}${location.hash}`)}`}
        replace
      />
    );
  if (user?.emailVerificationRequired && !user.onboardingComplete && location.pathname !== '/onboarding')
    return (
      <Navigate
        to={`/onboarding?returnTo=${encodeURIComponent(`${location.pathname}${location.search}${location.hash}`)}`}
        replace
      />
    );
  return <Outlet />;
}
