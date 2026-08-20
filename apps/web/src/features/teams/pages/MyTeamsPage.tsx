import { Link } from 'react-router-dom';
import { FormError } from '@/components/ui/FormError.js';
import { TeamCard } from '../components/TeamCard.js';
import { useMyTeams } from '../hooks/useTeams.js';

export function MyTeamsPage() {
  const teams = useMyTeams();
  return (
    <section className="grid gap-7">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-brand-600">My Teams</p>
          <h1 className="mt-2 text-3xl font-black text-content-strong">Your football clubs</h1>
          <p className="mt-2 text-content-muted">
            Create squads, invite players, and save a formation for every format.
          </p>
        </div>
        <Link className="button" to="/teams/create">
          Create Team
        </Link>
      </header>
      <FormError message={teams.error?.message} />
      {teams.isPending && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="h-36 animate-pulse rounded-2xl bg-surface" />
          ))}
        </div>
      )}
      {teams.data?.length === 0 && (
        <div className="rounded-3xl border border-dashed border-line-strong bg-surface p-10 text-center">
          <h2 className="text-xl font-bold text-content-strong">Your first team starts here</h2>
          <p className="mt-2 text-content-muted">
            Team creation is free and does not use your wallet.
          </p>
          <Link className="button mt-5" to="/teams/create">
            Create Team
          </Link>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {teams.data?.map((team) => (
          <TeamCard key={team.id} team={team} />
        ))}
      </div>
    </section>
  );
}
