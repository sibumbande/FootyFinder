import { Link } from 'react-router-dom';
import { FormError } from '@/components/ui/FormError.js';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { UserCard } from '../components/UserCard.js';
import { useUsers } from '../hooks/useUsers.js';
export function HomePage() {
  const { user } = useAuth();
  const users = useUsers();
  const name = user?.displayName || user?.username || 'player';
  return (
    <section className="grid gap-8">
      <div className="overflow-hidden rounded-3xl bg-brand-900 p-6 text-content-inverse shadow-soft sm:p-9">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-brand-100">
              Footy Finder community
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Welcome back, {name}
            </h1>
            <p className="mt-3 max-w-xl leading-7 text-brand-100">
              Meet footballers, discover nearby games, and organise your next match.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/teams/create"
              className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-xl border border-content-inverse/30 px-5 font-bold text-content-inverse transition hover:-translate-y-0.5 hover:bg-content-inverse/10"
            >
              Create Team
            </Link>
            <Link
              to="/matches/new"
              className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-xl bg-content-inverse px-5 font-bold text-brand-900 shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft"
            >
              Create Match!
            </Link>
          </div>
        </div>
      </div>
      <div>
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-content-strong">Players</h2>
            <p className="mt-1 text-sm text-content-muted">
              Public football profiles. Private contact details stay private.
            </p>
          </div>
          {users.data && (
            <span className="rounded-full bg-brand-50 px-3 py-1 text-sm font-bold text-brand-700">
              {users.data.length} players
            </span>
          )}
        </div>
        {users.isPending && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="h-36 animate-pulse rounded-2xl bg-surface" />
            ))}
          </div>
        )}
        <FormError message={users.error?.message} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {users.data?.map((listedUser) => (
            <UserCard key={listedUser.id} user={listedUser} />
          ))}
        </div>
      </div>
    </section>
  );
}
