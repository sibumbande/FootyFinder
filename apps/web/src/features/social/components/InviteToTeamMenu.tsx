import { useState } from 'react';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { useTeamInviteAction } from '../hooks/useSocial.js';

/** Gate 9 / TKT-904: "Invite to team" on a friend, for the teams you own or captain. */
export function InviteToTeamMenu({ userId, source = 'FRIEND' }: { userId: string; source?: 'FRIEND' | 'LOOKING' }) {
  const { user } = useAuth();
  const action = useTeamInviteAction();
  const teams = (user?.teams ?? []).filter(({ role }) => role === 'OWNER' || role === 'CAPTAIN');
  const [teamId, setTeamId] = useState('');
  if (!teams.length) return null;
  const chosen = teamId || teams[0]!.id;
  if (action.isSuccess) return <span className="text-[11px] font-black uppercase text-brand-700">Invited</span>;
  return (
    <span className="flex flex-col items-end gap-1">
      <span className="flex items-center gap-1">
        {teams.length > 1 && (
          <select aria-label="Team" className="max-w-32 rounded-md border border-line bg-surface px-1 py-1 text-[11px]" value={chosen} onChange={(event) => setTeamId(event.target.value)}>
            {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        )}
        <button
          type="button"
          className="text-[11px] font-black uppercase tracking-[0.06em] text-brand-700 hover:underline"
          disabled={action.isPending}
          onClick={() => action.mutate({ kind: 'invite', teamId: chosen, userId, source })}
        >
          {teams.length > 1 ? 'Invite' : `Invite to ${teams[0]!.name}`}
        </button>
      </span>
      {action.error && <span role="alert" className="max-w-48 text-right text-[11px] font-semibold text-danger-700">{action.error.message}</span>}
    </span>
  );
}
