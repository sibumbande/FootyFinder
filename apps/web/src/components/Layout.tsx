import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { useNotifications } from '@/features/notifications/NotificationProvider.js';
import { NotificationsMenu } from '@/features/notifications/NotificationsMenu.js';
import { useAddFunds } from '@/features/wallet/hooks/useWallet.js';
import { formatRands } from '@/utils/format-currency.js';
import { Logo } from './Logo.js';
import { ThemeToggle } from './ThemeToggle.js';
import { UserMenu } from './UserMenu.js';
import { Button } from './ui/Button.js';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `relative rounded-md px-3 py-2 text-xs font-black uppercase tracking-[0.08em] transition ${isActive ? 'bg-brand-600 text-content-inverse shadow-[3px_3px_0_rgb(var(--theme-accent-gold))]' : 'text-content-muted hover:-translate-y-0.5 hover:bg-surface-hover hover:text-content-strong'}`;

export function Layout() {
  const { user } = useAuth();
  const addFunds = useAddFunds();
  const { notify } = useNotifications();
  const addDemoFunds = () =>
    addFunds.mutate(undefined, {
      onSuccess: () =>
        notify({
          variant: 'success',
          title: 'Funds added',
          message: 'R500.00 was added to your wallet.',
        }),
      onError: (error) =>
        notify({ variant: 'error', title: 'Deposit unsuccessful', message: error.message }),
    });

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
            <NavLink to="/messages" className={navClass}>
              Messages
            </NavLink>
            <NavLink to="/teams" className={navClass}>
              Teams
            </NavLink>
          </nav>
          <div className="ml-auto sm:ml-1">
            <ThemeToggle />
          </div>
          {user && (
            <>
              <Button
                variant="secondary"
                loading={addFunds.isPending}
                onClick={addDemoFunds}
                className="min-h-10 px-3 sm:min-h-11 sm:px-4"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span className="hidden sm:inline">Add funds</span>
              </Button>
              <div
                className="rounded-md border border-line-strong bg-brand-900 px-2.5 py-2 text-right text-content-inverse shadow-[2px_2px_0_rgb(var(--theme-accent-gold))] sm:px-3"
                title="Wallet balance"
              >
                <span className="hidden text-[9px] font-black uppercase tracking-[0.14em] text-warning-200 sm:block">
                  Balance
                </span>
                <span className="block whitespace-nowrap text-sm font-black text-content-inverse">
                  {formatRands(user.balanceCents)}
                </span>
              </div>
              <NotificationsMenu />
              <UserMenu />
            </>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
