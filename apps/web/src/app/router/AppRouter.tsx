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
import { InviteMatchPage } from '@/features/matches/pages/InviteMatchPage.js';
import { MessagesPage } from '@/features/messaging/pages/MessagesPage.js';
import { PlayerProfilePage } from '@/features/users/pages/PlayerProfilePage.js';
import { HomePage } from '@/features/users/pages/HomePage.js';
import { MyTeamsPage } from '@/features/teams/pages/MyTeamsPage.js';
import { CreateTeamPage } from '@/features/teams/pages/CreateTeamPage.js';
import { TeamPage } from '@/features/teams/pages/TeamPage.js';
import { TeamInvitePage } from '@/features/teams/pages/TeamInvitePage.js';
import { CreateTeamMatchPage } from '@/features/teams/pages/CreateTeamMatchPage.js';
import { PageTransition } from './PageTransition.js';
import { SupportPage } from '@/features/support/pages/SupportPage.js';
import { BookingsPage } from '@/features/bookings/pages/BookingsPage.js';
import { ReportPage } from '@/features/moderation/pages/ReportPage.js';

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
            <Route path="/matches/invite/:token" element={animated(<InviteMatchPage />)} />
            <Route path="/players/:userId" element={animated(<PlayerProfilePage />)} />
            <Route path="/messages" element={animated(<MessagesPage />)} />
            <Route path="/messages/:conversationId" element={animated(<MessagesPage />)} />
            <Route path="/messages/new/:userId" element={animated(<MessagesPage />)} />
            <Route path="/teams" element={animated(<MyTeamsPage />)} />
            <Route path="/teams/create" element={animated(<CreateTeamPage />)} />
            <Route path="/teams/:teamId/matches/new" element={animated(<CreateTeamMatchPage />)} />
            <Route path="/teams/:teamId" element={animated(<TeamPage />)} />
            <Route path="/support" element={animated(<SupportPage />)} />
            <Route path="/support/:ticketId" element={animated(<SupportPage />)} />
            <Route path="/bookings" element={animated(<BookingsPage />)} />
            <Route path="/bookings/:bookingId" element={animated(<BookingsPage />)} />
            <Route path="/report/:targetType/:targetId" element={animated(<ReportPage />)} />
          </Route>
        </Route>
        <Route path="/teams/invite/:token" element={animated(<TeamInvitePage />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
