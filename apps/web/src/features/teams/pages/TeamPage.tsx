import { MATCH_FORMAT_CONFIG, type TeamDetail, type TeamRole } from '@footy-finder/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar.js';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { Input } from '@/components/ui/Input.js';
import { useNotifications } from '@/features/notifications/NotificationProvider.js';
import { formatDate } from '@/utils/format-date.js';
import { TeamHeroView, TeamTabs } from '../components/TeamHeroView.js';
import { TeamFormationEditor } from '../components/TeamFormationEditor.js';
import { TeamInvitePanel } from '../components/TeamInvitePanel.js';
import { TeamWalletPanel } from '../components/TeamWalletPanel.js';
import { TeamChatPanel } from '../components/TeamChatPanel.js';
import { TeamReviewsSection } from '@/features/team-reviews/components/TeamReviewsSection.js';
import {
  useDeleteTeam,
  useTeam,
  useTeamMemberMutation,
  useTeamMatches,
  useUpdateTeam,
  useUploadTeamImage,
} from '../hooks/useTeams.js';
import { useTeamSocket } from '../hooks/useTeamSocket.js';
import { FriendButton } from '@/features/social/components/FriendButton.js';

type Tab = 'overview' | 'matches' | 'squad' | 'formation' | 'wallet' | 'chat' | 'invites' | 'settings';
export function TeamPage() {
  const { teamId = '' } = useParams();
  useTeamSocket(teamId);
  const team = useTeam(teamId);
  const [search] = useSearchParams();
  const [tab, setTab] = useState<Tab>((search.get('tab') as Tab | null) ?? 'overview');
  if (team.isPending) return <div className="h-[40rem] animate-pulse rounded-3xl bg-surface" />;
  if (!team.data || team.error)
    return <FormError message={team.error?.message ?? 'Team not found.'} />;
  const archived = Boolean(team.data.archivedAt);
  const allowedTabs: Tab[] = ['overview', 'matches', 'squad', 'formation'];
  if (team.data.viewerRole) allowedTabs.push('wallet', 'chat');
  if (!archived && (team.data.viewerRole === 'OWNER' || team.data.viewerRole === 'CAPTAIN'))
    allowedTabs.push('invites');
  if (!archived && team.data.viewerRole === 'OWNER') allowedTabs.push('settings');
  return (
    <section className="grid gap-6">
      <TeamHero team={team.data} />
      {archived && (
        <p role="status" className="rounded-2xl border border-line bg-surface-muted p-4 text-sm font-semibold text-content">
          This team was closed on {formatDate(team.data.archivedAt!)}. Its history is kept, and any unspent contributions were returned to each contributor&apos;s wallet.
        </p>
      )}
      <TeamTabs tabs={allowedTabs} current={tab} onChange={setTab} />
      <div className="rounded-3xl border border-line bg-surface p-5 shadow-sm sm:p-7">
        {tab === 'overview' && <Overview team={team.data} />}
        {tab === 'matches' && <TeamMatches team={team.data} />}
        {tab === 'squad' && <Squad team={team.data} />}
        {tab === 'formation' && <TeamFormationEditor team={team.data} />}
        {tab === 'wallet' && <TeamWalletPanel team={team.data} />}
        {tab === 'chat' && <TeamChatPanel team={team.data} />}
        {tab === 'invites' && <TeamInvitePanel team={team.data} />}
        {tab === 'settings' && <TeamSettings team={team.data} />}
      </div>
    </section>
  );
}
function TeamHero({ team }: { team: TeamDetail }) {
  return (
    <TeamHeroView
      team={team}
      memberCount={team.memberCount}
      badge={team.viewerRole && (
        <span className="rounded-full bg-brand-50 px-3 py-1 text-sm font-bold text-brand-700">
          {team.viewerRole.toLowerCase()}
        </span>
      )}
      action={!team.archivedAt && (team.viewerRole === 'OWNER' || team.viewerRole === 'CAPTAIN') && (
        <Link className="button" to={`/matches/new?playAs=team:${team.id}&lock=1`}>
          Create team match
        </Link>
      )}
    />
  );
}
function TeamMatches({ team }: { team: TeamDetail }) {
  const matches = useTeamMatches(team.id);
  const canManage = team.viewerRole === 'OWNER' || team.viewerRole === 'CAPTAIN';
  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-content-strong">Team matches</h2>
          <p className="mt-1 text-sm text-content-muted">
            Public team matches at FootyFinder venues, plus any earlier private planning drafts.
          </p>
        </div>
        {canManage && !team.archivedAt && (
          <Link className="button" to={`/matches/new?playAs=team:${team.id}&lock=1`}>
            Create team match
          </Link>
        )}
      </div>
      <FormError message={matches.error?.message} />
      {matches.isPending && <div className="h-28 animate-pulse rounded-2xl bg-surface-muted" />}
      {matches.data?.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line-strong p-8 text-center text-content-muted">
          No Team fixtures have been organised yet.
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {matches.data?.map((match) => (
          <Link
            key={match.id}
            to={`/matches/${match.id}`}
            className="rounded-2xl border border-line p-4 transition hover:border-brand-300 hover:bg-surface-hover"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-bold text-content-strong">{match.name}</h3>
              <span className="rounded-full bg-brand-50 px-2 py-1 text-[10px] font-bold uppercase text-brand-700">
                {match.status}
              </span>
            </div>
            <p className="mt-2 text-sm text-content-muted">
              {MATCH_FORMAT_CONFIG[match.format].shortLabel} · {formatDate(match.startsAt)}
            </p>
            <p className="mt-1 text-xs text-content-muted">{match.venue.name}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
function Overview({ team }: { team: TeamDetail }) {
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_18rem]">
      <div>
        <h2 className="text-xl font-bold text-content-strong">About the Team</h2>
        <p className="mt-3 leading-7 text-content">
          {team.description || 'This Team has not added a description yet.'}
        </p>
      </div>
      {/* Gate 8 / TKT-810 (DEC-017): anonymous public reviews from opposing players. */}
      <div className="md:col-span-2 md:row-start-2">
        <TeamReviewsSection teamId={team.id} isMember={Boolean(team.viewerRole)} />
      </div>
      <aside className="rounded-2xl bg-surface-muted p-4 md:row-start-1">
        <p className="text-xs font-bold uppercase text-content-muted">Owner</p>
        <Link to={`/players/${team.owner.id}`} className="mt-3 flex items-center gap-3">
          <Avatar user={team.owner} />
          <span className="font-bold text-content-strong">{team.owner.displayName}</span>
        </Link>
      </aside>
    </div>
  );
}
function Squad({ team }: { team: TeamDetail }) {
  const management = useTeamMemberMutation(team.id);
  const { notify } = useNotifications();
  const owner = team.viewerRole === 'OWNER';
  const change = (userId: string, role: Exclude<TeamRole, 'OWNER'>) =>
    management.role.mutate(
      { userId, role },
      {
        onSuccess: () =>
          notify({
            variant: 'success',
            title: 'Role updated',
            message: `Member is now a ${role.toLowerCase()}.`,
          }),
      },
    );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {team.members.map((member) => (
        <article key={member.id} className="rounded-2xl border border-line p-4">
          <div className="flex items-start gap-3">
            <Link to={`/players/${member.userId}`}>
              <Avatar user={member.user} />
            </Link>
            <div className="min-w-0 flex-1">
              <Link
                className="font-bold text-content-strong hover:text-brand-700"
                to={`/players/${member.userId}`}
              >
                {member.user.displayName}
              </Link>
              <p className="text-xs font-bold uppercase text-brand-700">{member.role}</p>
              <p className="mt-1 text-xs text-content-muted">
                {member.user.preferredPositions.map((item) => item.toLowerCase()).join(', ') ||
                  'Positions not set'}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <FriendButton userId={member.userId} />
              {member.userId !== team.ownerUserId && (
                <Link
                  className="text-xs font-bold text-brand-700"
                  to={`/messages/new/${member.userId}`}
                >
                  Message
                </Link>
              )}
            </div>
          </div>
          {owner && member.role !== 'OWNER' && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
              <Button
                variant="secondary"
                onClick={() =>
                  change(member.userId, member.role === 'CAPTAIN' ? 'MEMBER' : 'CAPTAIN')
                }
              >
                {member.role === 'CAPTAIN' ? 'Demote' : 'Promote'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  if (window.confirm(`Remove ${member.user.displayName} from the Team?`))
                    management.remove.mutate(member.userId);
                }}
              >
                Remove
              </Button>
            </div>
          )}
        </article>
      ))}
      <FormError message={management.role.error?.message ?? management.remove.error?.message} />
    </div>
  );
}
function TeamSettings({ team }: { team: TeamDetail }) {
  const [name, setName] = useState(team.name);
  const [shortName, setShortName] = useState(team.shortName ?? '');
  const [description, setDescription] = useState(team.description ?? '');
  const [locationText, setLocation] = useState(team.locationText ?? '');
  const update = useUpdateTeam(team.id);
  const image = useUploadTeamImage(team.id);
  const deletion = useDeleteTeam(team.id);
  const navigate = useNavigate();
  const { notify } = useNotifications();
  const shortNameValid = !shortName || /^[A-Z0-9]{1,4}$/.test(shortName);
  return (
    <div className="grid gap-7">
      <div className="grid gap-4">
        <h2 className="text-xl font-bold text-content-strong">Team settings</h2>
        <Input label="Team name" value={name} onChange={(event) => setName(event.target.value)} />
        <Input
          label="Short name"
          value={shortName}
          maxLength={4}
          pattern="[A-Z0-9]{1,4}"
          onChange={(event) => setShortName(event.target.value.toUpperCase())}
          error={shortName && !shortNameValid ? 'Use up to four letters or numbers.' : undefined}
          hint="Unique, uppercase, and no more than four letters or numbers."
        />
        <Input
          label="Location"
          value={locationText}
          onChange={(event) => setLocation(event.target.value)}
        />
        <label className="grid gap-2 text-sm font-semibold text-content">
          Description
          <textarea
            className="min-h-28 rounded-xl border border-line-strong bg-surface p-3"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <Button
          loading={update.isPending}
          disabled={!shortNameValid}
          onClick={() =>
            update.mutate(
              { name, shortName: shortName || undefined, description, locationText },
              {
                onSuccess: () =>
                  notify({
                    variant: 'success',
                    title: 'Team updated',
                    message: 'The Team profile changes are live.',
                  }),
              },
            )
          }
        >
          Save details
        </Button>
      </div>
      <div className="border-t border-line pt-6">
        <label className="grid gap-2 text-sm font-semibold text-content">
          Replace Team image
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="rounded-xl border border-line-strong p-3"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) image.mutate(file);
            }}
          />
        </label>
      </div>
      <div className="border-t border-danger-200 pt-6">
        <h3 className="font-bold text-danger-700">Close Team</h3>
        <p className="mt-1 text-sm text-content-muted">
          Closing archives the Team: nobody can join, invite or play as it any more, but its match and
          wallet history is kept. Each member&apos;s unspent contributions go back to their own wallet.
          You can close a Team only when it has no upcoming team match and no money held for one.
        </p>
        <Button
          variant="secondary"
          className="mt-4"
          loading={deletion.isPending}
          onClick={() => {
            if (window.confirm(`Close ${team.name}? Unspent contributions will be returned to each member's wallet.`))
              deletion.mutate(undefined, {
                onSuccess: () => navigate('/teams', { replace: true }),
              });
          }}
        >
          Close Team
        </Button>
      </div>
      <FormError
        message={update.error?.message ?? image.error?.message ?? deletion.error?.message}
      />
    </div>
  );
}
