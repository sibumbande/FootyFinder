import {
  CANCELLATION_CUTOFF_HOURS,
  getMaxMatchParticipants,
  MATCH_FORMAT_CONFIG,
  MATCH_RULE_CONFIG,
} from '@footy-finder/shared';
import { ApiError } from '@footy-finder/api-client';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { ChatPanel } from '@/features/chat/components/ChatPanel.js';
import { useMatchSocket } from '@/features/chat/hooks/useMatchSocket.js';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { useNotifications } from '@/features/notifications/NotificationProvider.js';
import { formatCurrency } from '@/utils/format-currency.js';
import { formatDate } from '@/utils/format-date.js';
import type { FormationBoardPlayer, FormationBoardSlot } from '../components/formation/FormationBoard.js';
import { QuickMatchPitches } from '../components/formation/QuickMatchPitches.js';
import { QUICK_MATCH_SIDE_BADGES, QUICK_MATCH_SIDE_LABELS } from '../constants/quick-match-sides.js';
import { GoNoGoBanner } from '../components/GoNoGoBanner.js';
import { MatchRefereeLine } from '../components/MatchRefereeLine.js';
import { MatchResultPanel } from '../components/MatchResultPanel.js';
import { MatchReviewPanel } from '@/features/team-reviews/components/MatchReviewPanel.js';
import { PlayedWithPanel } from '@/features/social/components/PlayedWithPanel.js';
import { rands } from '../utils/go-no-go-format.js';
import { TeamMatchDayLobby } from '../components/TeamMatchDayLobby.js';
import { JoinTeamDialog } from '../components/JoinTeamDialog.js';
import { MatchTimer } from '../components/MatchTimer.js';
import { ResultForm } from '../components/ResultForm.js';
import { FreeMatchBadge, GirlsOnlyBadge, HostedByFootyFinderBadge } from '../components/FreeMatchBadge.js';
import { MatchVenuePhoto } from '../components/MatchVenuePhoto.js';
import { ShareMatchActions } from '../components/ShareMatchActions.js';
import {
  useCancellationQuote,
  useCancellationStatus,
  useChangeTeam,
  useClaimPosition,
  useDeleteMatch,
  useFormationUpdate,
  useLeaveMatch,
  useMatch,
  useReadyMatch,
  useRotateMatchInvite,
} from '../hooks/useMatches.js';
import { FriendButton } from '@/features/social/components/FriendButton.js';
import { useScrollToFormation } from '../hooks/useScrollToFormation.js';
export function MatchLobbyPage() {
  const { matchId = '' } = useParams();
  useMatchSocket(matchId);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { notify } = useNotifications();
  const matchQuery = useMatch(matchId);
  const leave = useLeaveMatch(matchId);
  const deletion = useDeleteMatch(matchId);
  const ready = useReadyMatch(matchId);
  const rotateInvite = useRotateMatchInvite(matchId);
  const formation = useFormationUpdate(matchId);
  const claimPosition = useClaimPosition(matchId);
  const changeTeam = useChangeTeam(matchId);
  const [joinOpen, setJoinOpen] = useState(false);
  const [tab, setTab] = useState<'formation' | 'players' | 'chat'>('formation');
  const match = matchQuery.data;
  useScrollToFormation(Boolean(match));
  const participants = match?.participants ?? [];
  // Stable board inputs: only a changed formation or roster produces new arrays (TKT-505).
  const boardSlots = useMemo<FormationBoardSlot[]>(
    () =>
      (match?.formationSlots ?? []).map((slot) => ({
        id: slot.id,
        team: slot.team,
        slotIndex: slot.slotIndex,
        positionX: slot.positionX,
        positionY: slot.positionY,
        playerId: slot.participantId,
        player: slot.participant?.user
          ? { id: slot.participant.id, team: slot.participant.team, user: slot.participant.user }
          : null,
      })),
    [match?.formationSlots],
  );
  const boardPlayers = useMemo<FormationBoardPlayer[]>(
    () =>
      (match?.participants ?? []).flatMap((participant) =>
        participant.user
          ? [{ id: participant.id, team: participant.team, user: participant.user }]
          : [],
      ),
    [match?.participants],
  );
  const onFieldIds = new Set(
    match?.formationSlots?.flatMap((slot) => (slot.participantId ? [slot.participantId] : [])) ??
      [],
  );
  const currentParticipant = participants.find((item) => item.userId === user?.id);
  const isHost = match?.createdById === user?.id;
  const quote = useCancellationQuote(matchId, Boolean(currentParticipant));
  const cancellationStatus = useCancellationStatus(
    matchId,
    Boolean(match) && match?.mode !== 'TEAM_MATCH',
  );
  if (matchQuery.isPending)
    return <div className="h-[42rem] animate-pulse rounded-3xl bg-surface" />;
  if (!match || matchQuery.error)
    return (
      <div>
        <FormError message={matchQuery.error?.message ?? 'Match not found.'} />
        <Link className="button mt-4" to="/matches">
          Back to discovery
        </Link>
      </div>
    );
  if (match.mode === 'TEAM_MATCH') return <TeamMatchDayLobby match={match} />;
  const mutable = ['OPEN', 'READY'].includes(match.status);
  const capacity = getMaxMatchParticipants(match.format, match.substituteCapacityPerTeam);
  const canChat = isHost || Boolean(currentParticipant);
  const cancelMatch = () => {
    if (
      !window.confirm(
        `Cancel this match? Every player gets their ${rands(match.feeCents)} refunded to their wallet and is notified by email.`,
      )
    )
      return;
    deletion.mutate(undefined, {
      onSuccess: () => {
        notify({
          variant: 'info',
          title: 'Match cancelled',
          message: 'Every player was refunded and notified.',
        });
        navigate('/matches', { replace: true });
      },
    });
  };
  const leaveMatch = () => {
    const initial = quote.data?.initialCreditCents ?? 0;
    const replacement = quote.data?.possibleReplacementCreditCents ?? 0;
    const detail =
      initial === 0 && replacement > 0
        ? `No credit is issued within ${CANCELLATION_CUTOFF_HOURS} hours of kickoff. ${formatCurrency(replacement)} will be credited if a replacement joins.`
        : replacement > 0
          ? `${formatCurrency(initial)} now, and ${formatCurrency(replacement)} if a replacement joins.`
          : `${formatCurrency(initial)} will be credited.`;
    if (window.confirm(`Leave this match? ${detail}`))
      leave.mutate(undefined, {
        onSuccess: () => notify({ variant: 'info', title: 'Place cancelled', message: detail }),
      });
  };
  const canClaim = mutable && Boolean(currentParticipant) && !isHost;
  const claimableSlotIds = canClaim
    ? (match.formationSlots ?? [])
        .filter((slot) => slot.team === currentParticipant?.team && !slot.participantId)
        .map((slot) => slot.id)
    : [];
  const claim = async (slotId: string) => {
    try {
      await claimPosition.mutateAsync(slotId);
      notify({ variant: 'success', title: 'Position claimed', message: 'You are on the pitch.' });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : undefined;
      notify({
        variant: 'error',
        title: code === 'POSITION_ALREADY_CLAIMED' ? 'Position taken' : 'Could not claim position',
        message:
          code === 'POSITION_ALREADY_CLAIMED'
            ? 'Another player claimed that position first. The formation has been refreshed.'
            : code === 'POSITION_WRONG_SIDE'
              ? 'You can only claim a position on your own team.'
              : code === 'MATCH_STARTED'
                ? 'Positions are locked once the match kicks off.'
                : error instanceof Error
                  ? error.message
                  : 'Please try again.',
      });
      throw error;
    }
  };
  const copyInvite = async () => {
    const inviteToken = match.inviteToken ?? (await rotateInvite.mutateAsync()).data.inviteToken;
    if (!inviteToken) return;
    await navigator.clipboard.writeText(`${window.location.origin}/matches/invite/${inviteToken}`);
    notify({
      variant: 'success',
      title: 'Invite copied',
      message: 'The private match link is ready to share.',
    });
  };
  return (
    <section className="grid gap-6">
      <header className="rounded-3xl bg-brand-900 p-6 text-content-inverse shadow-soft sm:p-8">
        <MatchVenuePhoto venue={match.venue} />
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-brand-100 px-3 py-1 text-xs font-bold text-brand-700">
                {MATCH_FORMAT_CONFIG[match.format].shortLabel}
              </span>
              <span className="rounded-full bg-content-inverse/10 px-3 py-1 text-xs font-bold">
                {match.status.replace('_', ' ')}
              </span>
              <span className="rounded-full bg-content-inverse/10 px-3 py-1 text-xs font-bold">
                {match.visibility.toLowerCase()}
              </span>
              {match.girlsOnly && <GirlsOnlyBadge onDark />}
              {match.hostedByFootyFinder && <HostedByFootyFinderBadge onDark />}
              {match.freeOnFootyFinder && <FreeMatchBadge onDark firstTimersOnly={match.firstTimersOnly} />}
              {isHost && (
                <span className="rounded-full bg-content-inverse/10 px-3 py-1 text-xs font-bold">
                  Organiser
                </span>
              )}
            </div>
            <h1 className="mt-4 text-3xl font-black sm:text-4xl">{match.name}</h1>
            <p className="mt-2 font-semibold text-hero-muted">
              {match.venue.name} · {match.venue.addressLine1}, {match.venue.city}
            </p>
            <p className="mt-2 text-sm text-hero-muted">
              {formatDate(match.startsAt)} · {match.durationMinutes} minutes ·{' '}
              {match.feeCents ? formatCurrency(match.feeCents) : 'Free'}
            </p>
            {match.description && (
              <p className="mt-4 max-w-2xl text-hero-muted">{match.description}</p>
            )}
            <p className="mt-3 text-sm text-hero-muted">
              {MATCH_FORMAT_CONFIG[match.format].startersPerTeam} starters +{' '}
              {match.substituteCapacityPerTeam} substitutes per team ·{' '}
              {match.rollingSubstitutes ? 'Rolling substitutions' : 'Standard substitutions'}
            </p>
            {match.rules.length > 0 && (
              <p className="mt-1 text-sm text-hero-muted">
                Rules: {match.rules.map((rule) => MATCH_RULE_CONFIG[rule].label).join(', ')}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <MatchTimer startsAt={match.startsAt} endsAt={match.matchEndsAt} />
            <div className="rounded-2xl bg-content-inverse/10 px-4 py-3 text-center">
              <span className="block text-xl font-black">
                {match.participantCount}/{capacity}
              </span>
              <span className="text-[10px] font-bold uppercase text-hero-muted">Players</span>
            </div>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          {!currentParticipant && mutable && match.participantCount < capacity && (
            <Button onClick={() => setJoinOpen(true)}>Join a team</Button>
          )}
          {currentParticipant && mutable && (
            <Button variant="secondary" onClick={leaveMatch} loading={leave.isPending}>
              Leave match
            </Button>
          )}
          {isHost && match.status === 'OPEN' && (
            <Button variant="secondary" onClick={() => ready.mutate()} loading={ready.isPending}>
              Mark ready
            </Button>
          )}
          {isHost && match.visibility === 'PRIVATE' && (
            <Button variant="secondary" onClick={copyInvite} loading={rotateInvite.isPending}>
              {match.inviteToken ? 'Copy invite link' : 'Generate invite link'}
            </Button>
          )}
          {isHost && !['COMPLETED', 'CANCELLED'].includes(match.status) && (
            <button
              onClick={cancelMatch}
              className="min-h-11 rounded-xl border border-danger-400 px-4 text-sm font-bold text-danger-400 hover:bg-danger-50"
            >
              Cancel match
            </button>
          )}
        </div>
        {match.visibility === 'PUBLIC' && match.canonicalUrl && (
          <div className="mt-4">
            <ShareMatchActions
              facts={{
                canonicalUrl: match.canonicalUrl,
                name: match.name,
                venueName: match.venue.name,
                startsAt: match.startsAt,
                filled: match.participantCount,
                total: capacity,
                feeCents: match.feeCents,
              }}
            />
          </div>
        )}
      </header>
      <GoNoGoBanner
        facts={match}
        status={match.status}
        feeCents={match.feeCents}
        filled={boardSlots.filter((slot) => slot.playerId).length}
        total={boardSlots.length}
        venueName={match.venue.name}
        startsAt={match.startsAt}
        viewerJoined={Boolean(currentParticipant)}
      />
      <MatchRefereeLine referee={match.referee} goNoGoAt={match.goNoGoAt} status={match.status} />
      <FormError
        message={leave.error?.message ?? deletion.error?.message ?? ready.error?.message}
      />
      {cancellationStatus.data && (
        <section className="grid gap-3 rounded-2xl border border-brand-200 bg-brand-50 p-5 sm:grid-cols-2">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-brand-700">
              Cancellation credit
            </p>
            <p className="mt-1 text-xl font-black text-content-strong">
              {formatCurrency(
                cancellationStatus.data.initialCreditCents +
                  cancellationStatus.data.replacementCreditCents,
              )}{' '}
              received
            </p>
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-brand-700">
              Replacement
            </p>
            <p className="mt-1 text-xl font-black text-content-strong">
              {cancellationStatus.data.replacementFound
                ? `Found - additional ${formatCurrency(cancellationStatus.data.replacementCreditCents)} credited`
                : 'Waiting for a player'}
            </p>
          </div>
        </section>
      )}
      <nav className="grid grid-cols-3 gap-1 rounded-xl bg-surface-muted p-1 md:hidden">
        {(['formation', 'players', 'chat'] as const).map((item) => (
          <button
            key={item}
            onClick={() => setTab(item)}
            className={`rounded-lg px-2 py-2 text-sm font-bold capitalize ${tab === item ? 'bg-surface text-brand-700 shadow-sm' : 'text-content-muted'}`}
          >
            {item}
          </button>
        ))}
      </nav>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <div
          id="formation"
          className={`scroll-mt-20 ${tab === 'formation' ? 'block' : 'hidden'} rounded-3xl border border-line bg-surface p-4 shadow-sm md:block sm:p-6`}
        >
          <QuickMatchPitches
            slots={boardSlots}
            players={boardPlayers}
            canEdit={isHost && mutable}
            claimableSlotIds={claimableSlotIds}
            onClaim={claim}
            currentPlayerId={currentParticipant?.id ?? null}
            currentSide={currentParticipant?.team ?? null}
            readonlyHint={
              canClaim
                ? 'Tap an open position on your team to claim it.'
                : 'The organiser controls the pre-match formation.'
            }
            onAssign={({ slotId, playerId }) =>
              formation.mutateAsync({ slotId, input: { participantId: playerId } })
            }
            onRemove={(slotId) => formation.mutateAsync({ slotId, input: { participantId: null } })}
            onMove={(slotId, input) => formation.mutateAsync({ slotId, input })}
          />
        </div>
        <div className={`${tab === 'chat' ? 'block' : 'hidden'} md:block`}>
          <ChatPanel matchId={match.id} enabled={canChat} />
        </div>
      </div>
      <div className={`${tab === 'players' ? 'grid' : 'hidden'} gap-4 md:grid md:grid-cols-2`}>
        {(['HOME', 'AWAY'] as const).map((team) => (
          <section
            key={team}
            className={`rounded-2xl border p-4 ${team === 'HOME' ? 'border-team-home-border bg-team-home-muted' : 'border-team-away-border bg-team-away-muted'}`}
          >
            <h2
              className={`flex items-center gap-2 font-bold ${team === 'HOME' ? 'text-team-home' : 'text-team-away'}`}
            >
              <span
                aria-hidden="true"
                className={`grid size-6 place-items-center rounded-full text-xs font-black text-on-team ${team === 'HOME' ? 'bg-team-home' : 'bg-team-away'}`}
              >
                {QUICK_MATCH_SIDE_BADGES[team]}
              </span>
              {QUICK_MATCH_SIDE_LABELS[team]}
            </h2>
            {participants
              .filter((item) => item.team === team)
              .map((player) => (
                <div
                  key={player.id}
                  className="mt-2 flex items-center gap-2 rounded-xl bg-surface p-3 text-sm font-semibold text-content-strong"
                >
                  <Link className="min-w-0 flex-1 truncate" to={`/players/${player.userId}`}>
                    {player.user?.displayName}
                  </Link>
                  <FriendButton userId={player.userId} />
                  {player.userId === user?.id && (
                    <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-black uppercase text-content-inverse">
                      You
                    </span>
                  )}
                  <span className="text-[10px] font-bold uppercase text-content-muted">
                    {onFieldIds.has(player.id) ? 'On pitch' : 'Reserve'}
                  </span>
                  {mutable &&
                    (isHost || player.userId === user?.id) &&
                    (isHost || !onFieldIds.has(player.id)) && (
                      <button
                        type="button"
                        onClick={() =>
                          changeTeam.mutate({
                            participantId: player.id,
                            team: team === 'HOME' ? 'AWAY' : 'HOME',
                          })
                        }
                        className="rounded-lg border border-line px-2 py-1 text-xs text-content-muted"
                      >
                        Move to {QUICK_MATCH_SIDE_LABELS[team === 'HOME' ? 'AWAY' : 'HOME']}
                      </button>
                    )}
                </div>
              ))}
          </section>
        ))}
      </div>
      {/* Gate 8: refereed matches (with a go/no-go) are recorded by the FootyFinder referee. */}
      {match.status === 'AWAITING_RESULT' && isHost && !match.goNoGoAt && (
        <ResultForm matchId={match.id} participants={participants} />
      )}
      {/* Gate 8 (DEC-020): a refereed match shows the referee's final result; results cannot be disputed (D21). */}
      <MatchResultPanel match={match} />
      <MatchReviewPanel match={match} />
      <PlayedWithPanel match={match} />
      {match.result && !match.goNoGoAt && (
        <section className="rounded-3xl border border-brand-200 bg-brand-50 p-8 text-center">
          <p className="text-sm font-black uppercase tracking-widest text-brand-700">Full time</p>
          <p className="mt-3 text-5xl font-black text-content-strong">
            {match.result.homeScore} — {match.result.awayScore}
          </p>
          <div className="mt-5 text-sm text-content">
            {match.result.scorers.map((scorer) => (
              <p key={scorer.id}>
                {scorer.participant?.user?.displayName} × {scorer.goals}
              </p>
            ))}
          </div>
        </section>
      )}
      <JoinTeamDialog match={match} open={joinOpen} onClose={() => setJoinOpen(false)} />
    </section>
  );
}
