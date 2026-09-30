import { Link, useParams } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar.js';
import { FormError } from '@/components/ui/FormError.js';
import { TeamAvatar } from '@/features/teams/components/TeamAvatar.js';
import { positionLabel } from '@/features/social/recruitment-labels.js';
import { SignUpPrompt } from '../components/SignUpPrompt.js';
import { usePublicPlayer } from '../hooks/usePublic.js';

/** Gate 9 / TKT-910: a player profile for visitors: name, username, photo, positions, city, bio, teams, stats. */
export function GuestPlayerPage() {
  const { userId = '' } = useParams();
  const player = usePublicPlayer(userId);
  if (player.isPending) return <div className="h-72 animate-pulse rounded-3xl bg-surface" />;
  if (!player.data) return <FormError message={player.error?.message ?? 'Player not found.'} />;
  const view = player.data;
  return (
    <section className="mx-auto grid max-w-3xl gap-6" data-testid="guest-player">
      <div className="rounded-3xl border border-line bg-surface p-6 shadow-sm sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <Avatar user={view} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl font-bold text-content-strong">{view.displayName}</h1>
            <p className="text-brand-700">@{view.username}</p>
            <p className="mt-1 text-sm text-content-muted">{view.city ?? 'City not set'}</p>
          </div>
          <SignUpPrompt action="add friend" compact />
        </div>
        <p className="mt-6 leading-7 text-content">{view.bio || 'This player has not added a bio yet.'}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {view.preferredPositions.map((position) => (
            <span key={position} className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">{positionLabel(position)}</span>
          ))}
        </div>
      </div>
      <section className="grid grid-cols-3 gap-3 sm:grid-cols-6" aria-label="Player statistics">
        {Object.entries(view.statistics).map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-line bg-surface p-4 text-center shadow-sm">
            <strong className="block text-2xl text-content-strong">{value}</strong>
            <span className="text-xs font-bold uppercase text-content-muted">{label.replace(/([A-Z])/g, ' $1')}</span>
          </div>
        ))}
      </section>
      {view.teams.length > 0 && (
        <section className="rounded-3xl border border-line bg-surface p-6 shadow-sm">
          <h2 className="text-xl font-bold text-content-strong">Teams</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {view.teams.map((team) => (
              <Link key={team.id} to={`/teams/${team.id}`} className="flex items-center gap-3 rounded-2xl border border-line p-3 hover:bg-surface-hover">
                <TeamAvatar team={team} size="sm" />
                <span className="font-bold text-content-strong">{team.name}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
