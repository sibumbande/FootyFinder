import { useParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar.js';
import { FormError } from '@/components/ui/FormError.js';
import { TeamAvatar } from '@/features/teams/components/TeamAvatar.js';
import { FORMAT_LABELS, positionLabel } from '@/features/social/recruitment-labels.js';
import { SignUpPrompt } from '../components/SignUpPrompt.js';
import { usePublicTeam } from '../hooks/usePublic.js';

/** Gate 9 / TKT-910: a team page for visitors: name, crest, members, results record, review average. */
export function GuestTeamPage() {
  const { teamId = '' } = useParams();
  const team = usePublicTeam(teamId);
  if (team.isPending) return <div className="h-72 animate-pulse rounded-3xl bg-surface" />;
  if (!team.data) return <FormError message={team.error?.message ?? 'Team not found.'} />;
  const view = team.data;
  return (
    <section className="grid gap-6" data-testid="guest-team">
      <header className="flex flex-wrap items-center gap-4 rounded-3xl border border-line bg-surface p-6 shadow-sm">
        <TeamAvatar team={view} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="anime-kicker">Team</p>
          <h1 className="mt-2 text-3xl font-black uppercase text-content-strong">{view.name}</h1>
          <p className="text-sm text-content-muted">
            {FORMAT_LABELS[view.primaryFormat]}{view.locationText ? ` · ${view.locationText}` : ''}{view.closed ? ' · Closed' : ''}
          </p>
        </div>
        <dl className="grid grid-cols-4 gap-3 text-center">
          {([['Played', view.record.played], ['Won', view.record.wins], ['Drawn', view.record.draws], ['Lost', view.record.losses]] as const).map(([label, value]) => (
            <div key={label}>
              <dt className="text-[10px] font-black uppercase text-content-muted">{label}</dt>
              <dd className="text-2xl font-black text-content-strong">{value}</dd>
            </div>
          ))}
        </dl>
      </header>
      {view.description && <p className="text-content">{view.description}</p>}
      <p className="text-sm text-content-muted">
        Reviews: {view.reviews.enoughReviews ? `${view.reviews.averageRating} / 5 from ${view.reviews.reviewCount} reviews` : 'Not enough reviews yet'}
      </p>
      <SignUpPrompt action="join or challenge this team" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {view.members.map((member) => (
          <Link key={member.userId} to={`/players/${member.userId}`} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 hover:bg-surface-hover">
            <Avatar user={member} />
            <span className="min-w-0">
              <span className="block truncate font-bold text-content-strong">{member.displayName}</span>
              <span className="block text-xs text-content-muted">{member.role.toLowerCase()} · {member.positions.map(positionLabel).join(', ') || 'Positions not set'}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
