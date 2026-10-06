import { TERMS_ANCHORS } from '@footy-finder/shared';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { NotificationsMenu } from '@/features/notifications/NotificationsMenu.js';
import { Logo } from './Logo.js';
import { ThemeToggle } from './ThemeToggle.js';
import { UserMenu } from './UserMenu.js';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `relative rounded-md px-3 py-2 text-xs font-black uppercase tracking-[0.08em] transition ${isActive ? 'bg-brand-600 text-content-inverse shadow-[3px_3px_0_rgb(var(--theme-accent-gold))]' : 'text-content-muted hover:-translate-y-0.5 hover:bg-surface-hover hover:text-content-strong'}`;

export function Layout() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const inSocial = pathname.startsWith('/social') || pathname.startsWith('/messages');
  // CEO touch-up batch 4, item 1 (D1): players who signed up before gender was asked answer once, first.
  const { search, hash } = useLocation();
  if (user?.onboardingComplete && user.missingOnboardingRequirements?.includes('GENDER') && pathname !== '/gender')
    return <Navigate to={`/gender?returnTo=${encodeURIComponent(`${pathname}${search}${hash}`)}`} replace />;

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-20 border-b-2 border-line-strong bg-surface/95 shadow-[0_5px_0_rgb(var(--theme-accent-scarlet)/0.85)] backdrop-blur">
        <div className="mx-auto flex h-[4.5rem] max-w-7xl items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-8">
          <Logo />
          <nav className="ml-auto hidden items-center gap-1 sm:flex">
            <NavLink end to="/" className={navClass}>
              Home
            </NavLink>
            <NavLink to="/matches" className={navClass}>
              Matches
            </NavLink>
            <NavLink to="/social" className={() => navClass({ isActive: inSocial })}>
              Social
            </NavLink>
            {/* Guests' Teams link opens a Social tab; it is a plain link so Social stays the highlighted item there. */}
            {user ? (
              <NavLink to="/teams" className={navClass}>
                Teams
              </NavLink>
            ) : (
              <Link to="/social?tab=teams" className={navClass({ isActive: false })}>
                Teams
              </Link>
            )}
            {user?.isReferee && (
              <NavLink to="/referee" className={navClass}>
                Referee
              </NavLink>
            )}
          </nav>
          <div className="ml-auto sm:ml-1">
            <ThemeToggle />
          </div>
          {!user && (
            <>
              <Link className="hidden text-xs font-black uppercase tracking-[0.08em] text-content-muted hover:text-content-strong sm:inline" to={`/login?returnTo=${encodeURIComponent(pathname)}`}>
                Log in
              </Link>
              <Link className="button" to={`/register?returnTo=${encodeURIComponent(pathname)}`} data-testid="guest-sign-up">
                Sign up to play
              </Link>
            </>
          )}
          {user && (
            <>
              <NotificationsMenu />
              <UserMenu />
            </>
          )}
        </div>
        {!user && (
          <nav className="flex justify-center gap-1 border-t border-line px-2 py-2 sm:hidden" aria-label="Guest navigation">
            <NavLink end to="/" className={navClass}>Home</NavLink>
            <NavLink to="/matches" className={navClass}>Matches</NavLink>
            <NavLink to="/social" className={() => navClass({ isActive: inSocial })}>Social</NavLink>
          </nav>
        )}
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <Outlet />
      </main>
      <footer className="border-t border-line bg-surface">
        <nav className="mx-auto flex max-w-7xl flex-wrap gap-x-5 gap-y-2 px-4 py-6 text-xs font-bold text-content-muted" aria-label="Legal">
          <Link to="/legal/terms">Terms</Link><Link to={`/legal/terms#${TERMS_ANCHORS.privacy}`}>Privacy</Link><Link to={`/legal/terms#${TERMS_ANCHORS.riskWaiver}`}>Risk waiver</Link><Link to="/waiting-list">City waiting list</Link>
        </nav>
      </footer>
    </div>
  );
}
