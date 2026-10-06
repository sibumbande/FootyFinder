import type { PublicTeamView } from '@footy-finder/shared';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar.js';
import { FormError } from '@/components/ui/FormError.js';
import { positionLabel } from '@/features/social/recruitment-labels.js';
import { FriendButton } from '@/features/social/components/FriendButton.js';
import { TeamHeroView, TeamTabs } from '@/features/teams/components/TeamHeroView.js';
import { GuestAction } from '../components/SignUpPrompt.js';
import { usePublicTeam } from '../hooks/usePublic.js';
import { plural } from '@/utils/plural.js';
import { TeamStatsPanel } from '@/features/teams/components/TeamStatsPanel.js';
import { PlayerName } from '@/components/ui/PlayerName.js';

const GUEST_TABS = ['overview', 'squad'] as const;
type GuestTab = (typeof GUEST_TABS)[number];

/**
 * Gate 9 / TKT-910, CEO touch-up batch 2, item 5: a visitor sees the same team page as a member
 * (header, tabs, overview, squad) built from the public team view; join, challenge, message and
 * add friend become "Sign up to play". Chat, invites and settings stay members-only.
 */
export function GuestTeamPage() {
  const { teamId = '' } = useParams();
  const [search] = useSearchParams();
  const requested = search.get('tab') as GuestTab | null;
  const [tab, setTab] = useState<GuestTab>(requested && GUEST_TABS.includes(requested) ? requested : 'overview');
  const team = usePublicTeam(teamId);
  if (team.isPending) return <div className="h-[40rem] animate-pulse rounded-3xl bg-surface" />;
  if (!team.data) return <FormError message={team.error?.message ?? 'Team not found.'} />;
  const view = team.data;
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-6" data-testid="guest-team">
      <TeamHeroView
        team={view}
        memberCount={view.members.length}
        action={!view.closed && <GuestAction action="join or challenge this team" />}
      />
      {view.closed && (
        <p role="status" className="rounded-2xl border border-line bg-surface-muted p-4 text-sm font-semibold text-content">
          This team has closed. Its history is kept.
        </p>
      )}
      <TeamTabs tabs={GUEST_TABS} current={tab} onChange={setTab} />
      <div className="rounded-3xl border border-line bg-surface p-5 shadow-sm sm:p-7">
        {tab === 'overview' && <Overview team={view} />}
        {tab === 'squad' && <Squad team={view} />}
      </div>
    </section>
  );
}

function Overview({ team }: { team: PublicTeamView }) {
  const owner = team.members.find(({ role }) => role === 'OWNER');
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[minmax(0,1fr)_18rem]">
      <div>
        <h2 className="text-xl font-bold text-content-strong">About the Team</h2>
        <p className="mt-3 leading-7 text-content">{team.description || 'This Team has not added a description yet.'}</p>
      </div>
      <div className="grid gap-4 md:col-span-2 md:row-start-2">
        <TeamStatsPanel stats={team.stats} />
        <div>
          <h2 className="text-xl font-bold text-content-strong">Reviews</h2>
          <p className="mt-2 text-content-muted">
            {team.reviews.enoughReviews ? `${team.reviews.averageRating} / 5 from ${plural(team.reviews.reviewCount ?? 0, 'review')}` : 'Not enough reviews.'}
          </p>
        </div>
      </div>
      {owner && (
        <aside className="rounded-2xl bg-surface-muted p-4 md:row-start-1">
          <p className="text-xs font-bold uppercase text-content-muted">Owner</p>
          <Link to={`/players/${owner.userId}`} className="mt-3 flex min-w-0 items-center gap-3">
            <Avatar user={owner} />
            <span className="min-w-0 flex-1"><PlayerName name={owner.displayName} className="font-bold text-content-strong" /></span>
          </Link>
        </aside>
      )}
    </div>
  );
}

function Squad({ team }: { team: PublicTeamView }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
      {team.members.map((member) => (
        <article key={member.userId} className="rounded-2xl border border-line p-4">
          <div className="flex items-start gap-3">
            <Link to={`/players/${member.userId}`}>
              <Avatar user={member} />
            </Link>
            <div className="min-w-0 flex-1">
              <Link className="block truncate font-bold text-content-strong hover:text-brand-700" to={`/players/${member.userId}`}>
                {member.displayName}
              </Link>
              <p className="text-xs font-bold uppercase text-brand-700">{member.role}</p>
              <p className="mt-1 text-xs text-content-muted">{member.positions.map(positionLabel).join(', ') || 'Positions not set'}</p>
            </div>
            <FriendButton userId={member.userId} />
          </div>
        </article>
      ))}
    </div>
  );
}
