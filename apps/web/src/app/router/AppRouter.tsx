import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/Layout.js';
import { GuestRoute } from '@/features/auth/components/GuestRoute.js';
import { ProtectedRoute } from '@/features/auth/components/ProtectedRoute.js';
import { GuestAwareRoute } from '@/features/auth/components/GuestAwareRoute.js';
import { MemberOrGuest } from '@/features/public/components/MemberOrGuest.js';
import { GuestMatchPage } from '@/features/public/pages/GuestMatchPage.js';
import { GuestPlayerPage } from '@/features/public/pages/GuestPlayerPage.js';
import { GuestTeamPage } from '@/features/public/pages/GuestTeamPage.js';
import { LoginPage } from '@/features/auth/pages/LoginPage.js';
import { RegisterPage } from '@/features/auth/pages/RegisterPage.js';
import { MatchListPage } from '@/features/matches/pages/MatchListPage.js';
import { CreateMatchPage } from '@/features/matches/pages/CreateMatchPage.js';
import { MatchLobbyPage } from '@/features/matches/pages/MatchLobbyPage.js';
import { InviteMatchPage } from '@/features/matches/pages/InviteMatchPage.js';
import { MessagesPage } from '@/features/messaging/pages/MessagesPage.js';
import { SocialPage } from '@/features/social/pages/SocialPage.js';
import { PlayerProfilePage } from '@/features/users/pages/PlayerProfilePage.js';
import { HomePage } from '@/features/users/pages/HomePage.js';
import { MyTeamsPage } from '@/features/teams/pages/MyTeamsPage.js';
import { CreateTeamPage } from '@/features/teams/pages/CreateTeamPage.js';
import { TeamPage } from '@/features/teams/pages/TeamPage.js';
import { TeamInvitePage } from '@/features/teams/pages/TeamInvitePage.js';
import { RetiredTeamFixtureRedirect } from '@/features/teams/pages/RetiredTeamFixtureRedirect.js';
import { PageTransition } from './PageTransition.js';
import { SupportPage } from '@/features/support/pages/SupportPage.js';
import { BookingsPage } from '@/features/bookings/pages/BookingsPage.js';
import { ReportPage } from '@/features/moderation/pages/ReportPage.js';
import { DisputesPage } from '@/features/disputes/pages/DisputesPage.js';
import { VerifyEmailPage } from '@/features/auth/pages/VerifyEmailPage.js';
import { ForgotPasswordPage } from '@/features/auth/pages/ForgotPasswordPage.js';
import { ResetPasswordPage } from '@/features/auth/pages/ResetPasswordPage.js';
import { ConfirmEmailChangePage } from '@/features/auth/pages/ConfirmEmailChangePage.js';
import { OnboardingPage } from '@/features/onboarding/pages/OnboardingPage.js';
import { GenderPage } from '@/features/onboarding/pages/GenderPage.js';
import { WaitingListPage } from '@/features/onboarding/pages/WaitingListPage.js';
import { LegalPage } from '@/features/legal/pages/LegalPage.js';
import { VenueDetailPage } from '@/features/venues/pages/VenueDetailPage.js';
import { PublicMatchPreviewPage } from '@/features/matches/pages/PublicMatchPreviewPage.js';
import { WalletPage } from '@/features/wallet/pages/WalletPage.js';
import { TopUpReturnPage } from '@/features/wallet/pages/TopUpReturnPage.js';
import { RefereePage } from '@/features/referee/pages/RefereePage.js';
import { RefereeMatchPage } from '@/features/referee/pages/RefereeMatchPage.js';
import { DeleteAccountPage } from '@/features/account/pages/DeleteAccountPage.js';
import { DeletionScheduledPage } from '@/features/account/pages/DeletionScheduledPage.js';
import { WelcomeBackPage } from '@/features/account/pages/WelcomeBackPage.js';

const animated = (page: ReactNode) => <PageTransition>{page}</PageTransition>;

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<GuestRoute />}>
          <Route path="/login" element={animated(<LoginPage />)} />
          <Route path="/register" element={animated(<RegisterPage />)} />
        </Route>
        <Route path="/verify-email" element={animated(<VerifyEmailPage />)} />
        <Route path="/forgot-password" element={animated(<ForgotPasswordPage />)} />
        <Route path="/reset-password" element={animated(<ResetPasswordPage />)} />
        <Route path="/confirm-email-change" element={animated(<ConfirmEmailChangePage />)} />
        <Route path="/waiting-list" element={animated(<WaitingListPage />)} />
        <Route path="/legal/:document" element={animated(<LegalPage />)} />
        <Route element={<Layout />}>
          <Route path="/account/deletion-scheduled" element={animated(<DeletionScheduledPage />)} />
        </Route>
        {/* CEO touch-up batch 2, item 5: the shared match link sits in the normal layout for everyone. */}
        <Route element={<Layout />}>
          <Route path="/m/:slug" element={animated(<PublicMatchPreviewPage />)} />
        </Route>
        {/* Gate 9 / TKT-910: pages anyone may browse; guests get the read-only view. */}
        <Route element={<GuestAwareRoute />}>
          <Route element={<Layout />}>
            <Route index element={animated(<HomePage />)} />
            <Route path="/matches" element={animated(<MatchListPage />)} />
            <Route path="/matches/:matchId" element={animated(<MemberOrGuest member={<MatchLobbyPage />} guest={<GuestMatchPage />} />)} />
            <Route path="/venues/:slug" element={animated(<VenueDetailPage />)} />
            <Route path="/players/:userId" element={animated(<MemberOrGuest member={<PlayerProfilePage />} guest={<GuestPlayerPage />} />)} />
            <Route path="/social" element={animated(<SocialPage />)} />
            <Route path="/teams/:teamId" element={animated(<MemberOrGuest member={<TeamPage />} guest={<GuestTeamPage />} />)} />
          </Route>
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/onboarding" element={animated(<OnboardingPage />)} />
            <Route path="/gender" element={animated(<GenderPage />)} />
            <Route path="/matches/new" element={animated(<CreateMatchPage />)} />
            <Route path="/referee" element={animated(<RefereePage />)} />
            <Route path="/referee/matches/:matchId" element={animated(<RefereeMatchPage />)} />
            <Route path="/matches/invite/:token" element={animated(<InviteMatchPage />)} />
            <Route path="/messages" element={<Navigate to="/social?tab=dms" replace />} />
            <Route path="/messages/:conversationId" element={animated(<MessagesPage />)} />
            <Route path="/messages/new/:userId" element={animated(<MessagesPage />)} />
            <Route path="/teams" element={animated(<MyTeamsPage />)} />
            <Route path="/teams/create" element={animated(<CreateTeamPage />)} />
            <Route path="/teams/:teamId/matches/new" element={<RetiredTeamFixtureRedirect />} />
            <Route path="/account/delete" element={animated(<DeleteAccountPage />)} />
            <Route path="/account/welcome-back" element={animated(<WelcomeBackPage />)} />
            <Route path="/wallet" element={animated(<WalletPage />)} />
            <Route path="/wallet/top-up/return" element={animated(<TopUpReturnPage />)} />
            <Route path="/support" element={animated(<SupportPage />)} />
            <Route path="/support/:ticketId" element={animated(<SupportPage />)} />
            <Route path="/bookings" element={animated(<BookingsPage />)} />
            <Route path="/bookings/:bookingId" element={animated(<BookingsPage />)} />
            <Route path="/report/:targetType/:targetId" element={animated(<ReportPage />)} />
            <Route path="/disputes" element={animated(<DisputesPage />)} />
            <Route path="/disputes/new/:type/:referenceId" element={animated(<DisputesPage />)} />
          </Route>
        </Route>
        <Route path="/teams/invite/:token" element={animated(<TeamInvitePage />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
