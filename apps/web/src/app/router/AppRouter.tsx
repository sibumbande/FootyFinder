import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/Layout.js';
import { GuestRoute } from '@/features/auth/components/GuestRoute.js';
import { ProtectedRoute } from '@/features/auth/components/ProtectedRoute.js';
import { LoginPage } from '@/features/auth/pages/LoginPage.js';
import { RegisterPage } from '@/features/auth/pages/RegisterPage.js';
import { MatchListPage } from '@/features/matches/pages/MatchListPage.js';
import { CreateMatchPage } from '@/features/matches/pages/CreateMatchPage.js';
import { MatchLobbyPage } from '@/features/matches/pages/MatchLobbyPage.js';
import { HomePage } from '@/features/users/pages/HomePage.js';
import { PageTransition } from './PageTransition.js';

const animated = (page: ReactNode) => <PageTransition>{page}</PageTransition>;

export function AppRouter() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route element={<GuestRoute />}>
          <Route path="/login" element={animated(<LoginPage />)} />
          <Route path="/register" element={animated(<RegisterPage />)} />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route index element={animated(<HomePage />)} />
            <Route path="/matches" element={animated(<MatchListPage />)} />
            <Route path="/matches/new" element={animated(<CreateMatchPage />)} />
            <Route path="/matches/:matchId" element={animated(<MatchLobbyPage />)} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
