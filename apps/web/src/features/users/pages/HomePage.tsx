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
      <div
        className="relative min-h-[25rem] overflow-hidden rounded-[1.4rem_1.4rem_1.4rem_0.45rem] border-2 border-brand-900 bg-brand-900 bg-cover bg-[72%_center] text-content-inverse shadow-[8px_9px_0_rgb(var(--theme-accent-scarlet))] sm:min-h-[30rem]"
        style={{ backgroundImage: "url('/art/matchday-heroes.png')" }}
      >
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgb(var(--theme-brand-900)/0.98)_0%,rgb(var(--theme-brand-900)/0.9)_38%,rgb(var(--theme-brand-900)/0.25)_72%,transparent_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_26%,rgb(var(--theme-accent-gold)/0.2)_0_1px,transparent_1.5px)] bg-[length:8px_8px] opacity-60" />
        <div className="relative flex min-h-[25rem] max-w-2xl flex-col justify-center p-6 sm:min-h-[30rem] sm:p-10 lg:p-12">
          <div>
            <p className="inline-flex -skew-x-6 bg-danger-600 px-3 py-1.5 text-xs font-black uppercase tracking-[0.2em] text-content-inverse shadow-[4px_4px_0_rgb(var(--theme-accent-gold))]">
              Matchday is calling
            </p>
            <h1 className="mt-5 max-w-xl text-4xl font-black uppercase leading-[0.92] tracking-tight drop-shadow-[3px_3px_0_rgb(var(--theme-brand-900))] sm:text-6xl">
              Welcome back,
              <span className="block text-warning-200">{name}</span>
            </h1>
            <p className="mt-5 max-w-lg text-base font-semibold leading-7 text-content-inverse/90 sm:text-lg">
              Meet footballers, discover nearby games, and organise your next match.
            </p>
          </div>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              to="/teams/create"
              className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-md border-2 border-content-inverse bg-brand-900/75 px-5 text-sm font-black uppercase tracking-wide text-content-inverse shadow-[3px_3px_0_rgb(var(--theme-content-inverse)/0.45)] transition hover:-translate-y-1 hover:bg-brand-700"
            >
              Create Team
            </Link>
            <Link
              to="/matches/new"
              className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-md border-2 border-brand-900 bg-warning-200 px-5 text-sm font-black uppercase tracking-wide text-brand-900 shadow-[4px_4px_0_rgb(var(--theme-accent-scarlet))] transition hover:-translate-y-1"
            >
              Kick off a match!
            </Link>
          </div>
        </div>
      </div>
      <div>
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="anime-kicker">The squad pool</p>
            <h2 className="mt-2 text-3xl font-black uppercase text-content-strong">
              Meet the players
            </h2>
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
