import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, useLogout } from '@/features/auth/hooks/useAuth.js';
import { Avatar } from './ui/Avatar.js';

export function UserMenu() {
  const { user } = useAuth();
  const logout = useLogout();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  if (!user) return null;
  const handleLogout = () =>
    logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) });

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 items-center gap-2 rounded-md px-1.5 py-1 text-content transition hover:bg-surface-hover focus:outline-none focus:ring-4 focus:ring-line"
      >
        <span className="hidden max-w-32 truncate text-sm font-semibold md:block">
          {user.username}
        </span>
        <Avatar user={user} size="sm" />
        <svg
          viewBox="0 0 20 20"
          className={`hidden size-4 text-content-muted transition sm:block ${open ? 'rotate-180' : ''}`}
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.22 7.22a.75.75 0 0 1 1.06 0L10 10.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 8.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <div role="menu" className="anime-panel absolute right-0 mt-2 w-64 origin-top-right p-2">
          <div className="border-b border-line px-3 py-3">
            <p className="truncate text-sm font-bold text-content-strong">{user.username}</p>
            <p className="mt-0.5 truncate text-xs text-content-muted">{user.email}</p>
          </div>
          <nav className="grid border-b border-line py-2 sm:hidden" aria-label="Mobile navigation">
            {[
              ['Home', '/'],
              ['Matches', '/matches'],
              ['Social', '/social'],
              ['Teams', '/teams'],
            ].map(([label, path]) => (
              <Link
                key={path}
                role="menuitem"
                to={path}
                onClick={() => setOpen(false)}
                className="flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-content hover:bg-surface-hover"
              >
                {label}
              </Link>
            ))}
          </nav>
          <Link
            role="menuitem"
            to={`/players/${user.id}`}
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-content hover:bg-surface-hover"
          >
            My Profile
          </Link>
          <Link
            role="menuitem"
            to="/wallet"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-content hover:bg-surface-hover"
          >
            Wallet
          </Link>
          {!user.onboardingComplete && (
            <Link
              role="menuitem"
              to="/onboarding"
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-warning-700 hover:bg-warning-50"
            >
              Complete Profile
            </Link>
          )}
          {user.isReferee && (
            <Link
              role="menuitem"
              to="/referee"
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-content hover:bg-surface-hover"
            >
              Referee
            </Link>
          )}
          <Link
            role="menuitem"
            to="/support"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-content hover:bg-surface-hover"
          >
            Support
          </Link>
          <Link
            role="menuitem"
            to="/disputes"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-content hover:bg-surface-hover"
          >
            My disputes
          </Link>
          <button
            role="menuitem"
            type="button"
            disabled={logout.isPending}
            onClick={handleLogout}
            className="mt-2 flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-content transition hover:bg-surface-hover disabled:opacity-60"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-5 text-content-muted"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M10 17l5-5-5-5M15 12H3M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" />
            </svg>
            {logout.isPending ? 'Logging out…' : 'Log out'}
          </button>
        </div>
      )}
    </div>
  );
}
