import { Link } from 'react-router-dom';
import { useMyTeams } from '@/features/teams/hooks/useTeams.js';
import { SocialEmpty } from './SocialEmpty.js';

/** Teams: your squads (the recruitment board joins this tab in TKT-909). */
export function TeamsTab({ query }: { query: string }) {
  const teams = useMyTeams();
  const needle = query.toLowerCase();
  const visible = (teams.data ?? []).filter((team) => !needle || team.name.toLowerCase().includes(needle));
  return (
    <div className="grid gap-3">
      {teams.data && visible.length === 0 && (
        <SocialEmpty message="No teams found.">
          <Link className="button" to="/teams/create">Create Team</Link>
        </SocialEmpty>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {visible.map((team) => (
          <Link key={team.id} to={`/teams/${team.id}`} className="rounded-2xl border border-line bg-surface p-4 font-black text-content-strong hover:bg-surface-hover">
            {team.name}
          </Link>
        ))}
      </div>
    </div>
  );
}
