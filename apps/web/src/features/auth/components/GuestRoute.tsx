import { Navigate, Outlet } from 'react-router-dom'; import { useAuth } from '../hooks/useAuth.js'; import { AuthLoadingScreen } from './AuthLoadingScreen.js';
export function GuestRoute() { const { isPending, isAuthenticated } = useAuth(); if (isPending) return <AuthLoadingScreen />; return isAuthenticated ? <Navigate to="/" replace /> : <Outlet />; }
