import {
  MATCH_FORMAT_CONFIG,
  MATCH_RULE_CONFIG,
  TEAM_MATCH_AVAILABILITY_STATUSES,
  type Match,
  type MatchTeamSide,
  type TeamMatchAvailabilityQuery,
  type TeamSide,
} from '@footy-finder/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { ChatPanel } from '@/features/chat/components/ChatPanel.js';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { useNotifications } from '@/features/notifications/NotificationProvider.js';
import { useTeam } from '@/features/teams/hooks/useTeams.js';
import { formatDate } from '@/utils/format-date.js';
import {
  FormationBoard,
  type FormationBoardPlayer,
  type FormationBoardSlot,
} from './formation/FormationBoard.js';
import {
  useTeamMatchAvailability,
  useTeamMatchAvailabilityMutations,
  useTeamMatchLineup,
  useTeamMatchLineupMutations,
} from '../hooks/useTeamMatchDay.js';
import { useDeleteMatch } from '../hooks/useMatches.js';
import { TeamMatchOtherSide } from './TeamMatchOtherSide.js';
import { TeamMeter } from './TeamMeter.js';
import { MatchRefereeLine } from './MatchRefereeLine.js';
import { MatchResultPanel } from './MatchResultPanel.js';
import { MatchReviewPanel } from '@/features/team-reviews/components/MatchReviewPanel.js';

type TeamMatchTab = 'availability' | 'lineup' | 'chat';

export function TeamMatchDayLobby({ match }: { match: Match }) {
  const [tab, setTab] = useState<TeamMatchTab>('availability');
  // Gate 7: a team match can have two team sides; show the viewer's own side first.
  const [selectedSide, setSelectedSide] = useState<TeamSide>(match.viewerTeamSide ?? 'HOME');
  const home = match.teamSides.find(({ side }) => side === 'HOME') ?? match.teamSides[0];
  const attached: MatchTeamSide | undefined = match.teamSides.find(({ side }) => side === selectedSide) ?? home;
  const publicTeamMatch = Boolean(match.otherSideMode);
  // D6 as narrowed by N5: only the home team's owner/captains can cancel the whole match.
  const canCancel = publicTeamMatch ? match.viewerManagedTeamSide === 'HOME' : match.viewerCanManage;
  const navigate = useNavigate();
  const { notify } = useNotifications();
  const deletion = useDeleteMatch(match.id, home?.teamId ?? undefined);
  if (!attached || !home)
    return <FormError message="This Team fixture does not have an attached Team side." />;
  return (
    <section className="grid gap-6">
      <header className="rounded-3xl bg-brand-900 p-6 text-content-inverse shadow-soft sm:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-brand-100 px-3 py-1 text-xs font-bold text-brand-700">
                Team Match · {MATCH_FORMAT_CONFIG[match.format].shortLabel}
              </span>
              <span className="rounded-full bg-content-inverse/10 px-3 py-1 text-xs font-bold">
                {match.status}
              </span>
              {match.viewerCanManage && (
                <span className="rounded-full bg-content-inverse/10 px-3 py-1 text-xs font-bold">
                  Match-Day manager
                </span>
              )}
            </div>
            <h1 className="mt-4 text-3xl font-black sm:text-4xl">{match.name}</h1>
            <p className="mt-2 font-semibold text-brand-100">
              {home.teamNameSnapshot}
              {publicTeamMatch && ` vs ${match.teamSides.find(({ side }) => side === 'AWAY')?.teamNameSnapshot ?? (match.otherSideTakenBy === 'INDIVIDUALS' ? 'Players' : 'Opponent wanted')}`}
              {' · '}
              {match.venue.name}
            </p>
            <p className="mt-2 text-sm text-brand-100">
              {formatDate(match.startsAt)} · {match.durationMinutes} minutes · {publicTeamMatch ? 'Public team match' : 'Private and free'}
            </p>
            {match.description && (
              <p className="mt-4 max-w-2xl text-brand-100">{match.description}</p>
            )}
          </div>
          <div className="rounded-2xl bg-content-inverse/10 px-4 py-3 text-center">
            <span className="block text-xl font-black">
              {MATCH_FORMAT_CONFIG[match.format].startersPerTeam} +{' '}
              {match.substituteCapacityPerTeam}
            </span>
            <span className="text-[10px] font-bold uppercase text-brand-100">
              Starters + substitutes
            </span>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2 text-sm text-brand-100">
          <span>
            {match.rollingSubstitutes ? 'Rolling substitutions' : 'Standard substitutions'}
          </span>
          {match.rules.length > 0 && (
            <span>· {match.rules.map((rule) => MATCH_RULE_CONFIG[rule].label).join(', ')}</span>
          )}
          {canCancel && !['CANCELLED', 'COMPLETED'].includes(match.status) && (
            <button
              type="button"
              className="ml-auto min-h-10 rounded-xl border border-danger-400 px-3 text-xs font-bold text-danger-400"
              onClick={() => {
                if (window.confirm(publicTeamMatch ? 'Cancel this team match for both sides? Held team money goes back to each team wallet and every player is refunded.' : 'Cancel this private Team fixture?'))
                  deletion.mutate(undefined, {
                    onSuccess: () => {
                      notify({ variant: 'info', title: 'Team fixture cancelled' });
                      navigate(`/teams/${home.teamId}`, { replace: true });
                    },
                  });
              }}
            >
              Cancel fixture
            </button>
          )}
        </div>
      </header>
      <MatchRefereeLine referee={match.referee} goNoGoAt={match.goNoGoAt} status={match.status} />
      <MatchResultPanel match={match} />
      <MatchReviewPanel match={match} />
      <FormError message={deletion.error?.message} />
      {publicTeamMatch && <TeamMeter match={match} />}
      {publicTeamMatch && <TeamMatchOtherSide match={match} />}
      {match.teamSides.length > 1 && (
        <nav className="grid grid-cols-2 gap-1 rounded-xl bg-surface-muted p-1" aria-label="Team sides">
          {match.teamSides.map((teamSide) => (
            <button
              key={teamSide.side}
              aria-pressed={selectedSide === teamSide.side}
              onClick={() => setSelectedSide(teamSide.side)}
              className={`min-h-11 rounded-lg px-3 text-sm font-bold ${selectedSide === teamSide.side ? 'bg-surface text-brand-700 shadow-sm' : 'text-content-muted'}`}
            >
              {teamSide.side === 'HOME' ? 'Home' : 'Away'}: {teamSide.teamNameSnapshot}
            </button>
          ))}
        </nav>
      )}
      <nav
        className="grid grid-cols-3 gap-1 rounded-xl bg-surface-muted p-1"
        aria-label="Match-Day sections"
      >
        {(['availability', 'lineup', 'chat'] as const).map((item) => (
          <button
            key={item}
            onClick={() => setTab(item)}
            className={`min-h-11 rounded-lg px-3 text-sm font-bold capitalize ${tab === item ? 'bg-surface text-brand-700 shadow-sm' : 'text-content-muted'}`}
          >
            {item}
          </button>
        ))}
      </nav>
      {tab === 'availability' && <AvailabilityPanel key={attached.side} match={match} teamSide={attached} />}
      {tab === 'lineup' && <LineupPanel key={attached.side} match={match} teamSide={attached} />}
      {tab === 'chat' && <ChatPanel matchId={match.id} enabled={match.viewerCanChat} />}
    </section>
  );
}

function AvailabilityPanel({ match, teamSide }: { match: Match; teamSide: MatchTeamSide }) {
  const { user } = useAuth();
  const side = teamSide.side;
  const [availability, setAvailability] = useState<TeamMatchAvailabilityQuery['availability']>();
  const [selected, setSelected] = useState<TeamMatchAvailabilityQuery['selected']>();
  const query = useTeamMatchAvailability(match.id, side, { availability, selected });
  const mutations = useTeamMatchAvailabilityMutations(match.id, side);
  const summary = query.data?.summary;
  return (
    <section className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-content-strong">Squad availability</h2>
          <p className="mt-1 text-sm text-content-muted">
            {query.data?.requestedAt
              ? `Requested ${formatDate(query.data.requestedAt)}`
              : 'Availability has not been requested yet.'}
          </p>
        </div>
        {match.viewerCanManage && (
          <Button loading={mutations.request.isPending} onClick={() => mutations.request.mutate()}>
            {query.data?.requestedAt ? 'Refresh Squad Pool' : 'Request availability'}
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ['Squad Pool', summary?.squadPool],
          ['Available', summary?.available],
          ['Maybe', summary?.maybe],
          ['Unavailable', summary?.unavailable],
          ['No response', summary?.noResponse],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-xs font-bold uppercase text-content-muted">{label}</p>
            <p className="mt-1 text-2xl font-black text-content-strong">{value ?? 0}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="grid gap-1 text-xs font-bold uppercase text-content-muted">
          Availability
          <select
            className="min-h-10 rounded-xl border border-line-strong bg-surface px-3 text-sm font-semibold normal-case text-content"
            value={availability ?? ''}
            onChange={(event) =>
              setAvailability((event.target.value || undefined) as typeof availability)
            }
          >
            <option value="">All responses</option>
            {TEAM_MATCH_AVAILABILITY_STATUSES.map((item) => (
              <option key={item} value={item}>
                {item.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-bold uppercase text-content-muted">
          Selection
          <select
            className="min-h-10 rounded-xl border border-line-strong bg-surface px-3 text-sm font-semibold normal-case text-content"
            value={selected === undefined ? '' : String(selected)}
            onChange={(event) =>
              setSelected(event.target.value === '' ? undefined : event.target.value === 'true')
            }
          >
            <option value="">All players</option>
            <option value="true">Selected</option>
            <option value="false">Not selected</option>
          </select>
        </label>
      </div>
      <FormError
        message={
          query.error?.message ??
          mutations.request.error?.message ??
          mutations.updateMine.error?.message
        }
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {query.data?.rows.map((row) => (
          <article key={row.id} className="rounded-2xl border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-bold text-content-strong">{row.user.displayName}</p>
                <p className="mt-1 text-xs font-bold uppercase text-brand-700">
                  {row.status.replace('_', ' ')}
                </p>
              </div>
              {row.selectionStatus && (
                <span className="rounded-full bg-brand-50 px-2 py-1 text-[10px] font-bold uppercase text-brand-700">
                  {row.selectionStatus.replaceAll('_', ' ')}
                </span>
              )}
            </div>
            {row.userId === user?.id && (
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {TEAM_MATCH_AVAILABILITY_STATUSES.map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => mutations.updateMine.mutate({ status })}
                    className={`min-h-9 rounded-lg border px-2 text-[10px] font-bold ${row.status === status ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line text-content-muted'}`}
                  >
                    {status.replace('_', ' ')}
                  </button>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function LineupPanel({ match, teamSide }: { match: Match; teamSide: MatchTeamSide }) {
  const attached = teamSide;
  const lineup = useTeamMatchLineup(match.id, attached.side);
  const team = useTeam(attached.teamId ?? '');
  const mutations = useTeamMatchLineupMutations(match.id, attached.side);
  const { notify } = useNotifications();
  if (lineup.isPending || team.isPending)
    return <div className="h-[38rem] animate-pulse rounded-3xl bg-surface" />;
  if (!lineup.data || lineup.error || !team.data)
    return (
      <FormError message={lineup.error?.message ?? team.error?.message ?? 'Lineup unavailable.'} />
    );
  const selectionByUser = new Map(
    lineup.data.selectionPool?.map((item) => [item.userId, item]) ?? [],
  );
  const players: FormationBoardPlayer[] = team.data.members.map((member) => ({
    id: member.userId,
    team: attached.side,
    user: member.user,
    badge: selectionByUser.get(member.userId)?.status.replaceAll('_', ' ') ?? 'Squad Pool',
  }));
  const playerById = new Map(players.map((player) => [player.id, player]));
  const slots: FormationBoardSlot[] = lineup.data.slots.map((slot) => ({
    id: slot.id,
    team: attached.side,
    slotIndex: slot.slotIndex,
    positionX: slot.positionX,
    positionY: slot.positionY,
    isOpen: slot.isOpen,
    playerId: slot.selection?.userId,
    player: slot.selection
      ? (playerById.get(slot.selection.userId) ?? {
          id: slot.selection.userId,
          team: attached.side,
          user: slot.selection.user,
        })
      : null,
  }));
  const starterLabel =
    match.format === 'FIVE_A_SIDE'
      ? 'Starting Five'
      : match.format === 'SEVEN_A_SIDE'
        ? 'Starting Seven'
        : 'Starting XI';
  const occupied = slots.filter((slot) => slot.playerId).length;
  const open = slots.filter((slot) => slot.isOpen).length;
  const errors = Object.values(mutations)
    .map((item) => item.error?.message)
    .find(Boolean);
  const success = (title: string, message: string) =>
    notify({ variant: 'success', title, message });
  return (
    <section className="grid gap-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label={starterLabel} value={`${occupied}/${lineup.data.starterCapacity}`} />
        <Stat label="Open positions" value={String(open)} />
        <Stat
          label="Substitutes"
          value={`${lineup.data.substitutes.length}/${lineup.data.substituteCapacity}`}
        />
        <Stat label="Status" value={lineup.data.lineupFinalizedAt ? 'Finalized' : 'Draft'} />
      </div>
      <FormError message={errors} />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(19rem,1fr)]">
        <div className="rounded-3xl border border-line bg-surface p-4 sm:p-6">
          <FormationBoard
            slots={slots}
            players={players}
            canEdit={lineup.data.viewerCanManage}
            sides={[attached.side]}
            occupiedDropMode="explicit"
            heading={starterLabel}
            editableHint="Drag or tap players into position. Occupied drops require an explicit action."
            readonlyHint="Managers organise the lineup; open positions can be claimed below."
            onAssign={({ slotId, playerId, displacedPlayerAction }) =>
              mutations.assign.mutateAsync({
                slotId,
                input: { userId: playerId, displacedPlayerAction },
              })
            }
            onRemove={(slotId) =>
              mutations.removeStarter.mutateAsync({ slotId, input: { playerAction: 'BENCH' } })
            }
            onMove={(slotId, input) => mutations.move.mutateAsync({ slotId, input })}
          />
        </div>
        <aside className="grid gap-4">
          <div className="rounded-2xl border border-line bg-surface p-4">
            <h3 className="font-bold text-content-strong">Position controls</h3>
            <div className="mt-3 grid gap-2">
              {lineup.data.slots.map((slot) => (
                <div key={slot.id} className="rounded-xl bg-surface-muted p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold">Position {slot.slotIndex}</span>
                    <span className="text-[10px] font-bold uppercase text-content-muted">
                      {slot.isOpen ? 'Open' : (slot.selection?.user.displayName ?? 'Empty')}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {lineup.data.viewerCanManage && slot.selection && (
                      <>
                        <Button
                          variant="ghost"
                          onClick={() =>
                            mutations.removeStarter.mutate({
                              slotId: slot.id,
                              input: { playerAction: 'BENCH' },
                            })
                          }
                        >
                          Bench
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() =>
                            mutations.removeStarter.mutate({
                              slotId: slot.id,
                              input: { playerAction: 'REMOVE' },
                            })
                          }
                        >
                          Remove
                        </Button>
                      </>
                    )}
                    {lineup.data.viewerCanManage && !slot.isOpen && (
                      <Button
                        variant="secondary"
                        onClick={() =>
                          mutations.open.mutate({
                            slotId: slot.id,
                            input: slot.selection ? { occupiedPlayerAction: 'BENCH' } : {},
                          })
                        }
                      >
                        Open
                      </Button>
                    )}
                    {!lineup.data.viewerCanManage && slot.isOpen && (
                      <Button onClick={() => mutations.claim.mutate(slot.id)}>
                        Claim position
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {lineup.data.viewerSelection &&
            !['DECLINED', 'REMOVED'].includes(lineup.data.viewerSelection.status) && (
              <Button
                variant="secondary"
                loading={mutations.decline.isPending}
                onClick={() => mutations.decline.mutate()}
              >
                Decline my selection
              </Button>
            )}
        </aside>
      </div>
      {lineup.data.viewerCanManage && (
        <section className="rounded-3xl border border-line bg-surface p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-content-strong">Squad Pool</h3>
              <p className="text-sm text-content-muted">
                Invite any current member or select them as a substitute.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                loading={mutations.finalize.isPending}
                onClick={() =>
                  mutations.finalize.mutate(undefined, {
                    onSuccess: () =>
                      success('Lineup finalized', 'The selected squad has been notified.'),
                  })
                }
              >
                Finalize lineup
              </Button>
              <Button
                variant="secondary"
                loading={mutations.saveDefault.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      'Save this Match-Day formation as the Team default? Open and empty slots will be unassigned; substitutes are ignored.',
                    )
                  )
                    mutations.saveDefault.mutate(undefined, {
                      onSuccess: () =>
                        success(
                          'Default formation saved',
                          'The Match lineup itself was not changed.',
                        ),
                    });
                }}
              >
                Save as Team default
              </Button>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {team.data.members.map((member) => {
              const selection = selectionByUser.get(member.userId);
              return (
                <article key={member.id} className="rounded-2xl border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-content-strong">
                      {member.user.displayName}
                    </span>
                    <span className="text-[10px] font-bold uppercase text-brand-700">
                      {selection?.status.replaceAll('_', ' ') ?? 'Not selected'}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1">
                    <Button variant="ghost" onClick={() => mutations.invite.mutate(member.userId)}>
                      Invite
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => mutations.selectSubstitute.mutate(member.userId)}
                    >
                      Substitute
                    </Button>
                    {selection?.status === 'SELECTED_SUBSTITUTE' && (
                      <Button
                        variant="ghost"
                        onClick={() => mutations.removeSubstitute.mutate(member.userId)}
                      >
                        Remove sub
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-xs font-bold uppercase text-content-muted">{label}</p>
      <p className="mt-1 text-xl font-black text-content-strong">{value}</p>
    </div>
  );
}
