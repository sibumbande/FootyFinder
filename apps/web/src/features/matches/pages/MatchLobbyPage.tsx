import { MATCH_CAPACITY, MATCH_FEE_CENTS } from '@footy-finder/shared';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { ChatPanel } from '@/features/chat/components/ChatPanel.js';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { formatDate } from '@/utils/format-date.js';
import { formatRands } from '@/utils/format-currency.js';
import { TeamRoster } from '../components/TeamRoster.js';
import { useDeleteMatch, useJoinMatch, useLeaveMatch, useMatch } from '../hooks/useMatches.js';

export function MatchLobbyPage() {
  const { matchId = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const matchQuery = useMatch(matchId);
  const join = useJoinMatch(matchId);
  const leave = useLeaveMatch(matchId);
  const deletion = useDeleteMatch(matchId);
  const match = matchQuery.data;
  const participants = match?.participants ?? [];
  const currentParticipant = participants.find((item) => item.userId === user?.id);
  const isHost = match?.createdById === user?.id;
  const actionError = join.error ?? leave.error ?? deletion.error;

  if (matchQuery.isPending)
    return (
      <div className="grid gap-5">
        <div className="h-44 animate-pulse rounded-3xl bg-surface" />
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="h-[38rem] animate-pulse rounded-3xl bg-surface" />
          <div className="h-[38rem] animate-pulse rounded-3xl bg-surface" />
        </div>
      </div>
    );
  if (matchQuery.error || !match)
    return (
      <div className="mx-auto max-w-xl">
        <FormError
          message={
            matchQuery.error instanceof Error ? matchQuery.error.message : 'Match lobby not found.'
          }
        />
        <Link className="button mt-4" to="/matches">
          Back to matches
        </Link>
      </div>
    );

  const deleteLobby = () => {
    if (
      !window.confirm(
        'Delete this match lobby permanently? Players will no longer be able to access it.',
      )
    )
      return;
    deletion.mutate(undefined, { onSuccess: () => navigate('/matches', { replace: true }) });
  };

  return (
    <section className="grid gap-7">
      <div className="rounded-3xl bg-brand-900 p-6 text-content-inverse shadow-soft sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-brand-100 px-3 py-1 text-xs font-bold text-brand-700">
                {match.status === 'FULL' ? 'Lobby full' : 'Open lobby'}
              </span>
              {isHost && (
                <span className="rounded-full bg-content-inverse/15 px-3 py-1 text-xs font-bold">
                  You are the host
                </span>
              )}
            </div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{match.name}</h1>
            <p className="mt-3 text-lg font-semibold text-brand-100">{match.venueName}</p>
            <p className="mt-1 text-sm text-brand-100">{match.address}</p>
            <p className="mt-4 text-sm font-bold">{formatDate(match.startsAt)}</p>
            {match.description && (
              <p className="mt-4 max-w-2xl leading-7 text-brand-100">{match.description}</p>
            )}
          </div>
          <div className="flex flex-col items-stretch gap-3 sm:flex-row lg:flex-col">
            <div className="rounded-2xl bg-content-inverse/10 px-5 py-3 text-center">
              <span className="block text-2xl font-bold">
                {match.participantCount}/{MATCH_CAPACITY}
              </span>
              <span className="text-xs font-semibold text-brand-100">Players joined</span>
            </div>
            {!currentParticipant && match.participantCount < MATCH_CAPACITY && (
              <Button onClick={() => join.mutate()} loading={join.isPending}>
                Join for {formatRands(MATCH_FEE_CENTS)}
              </Button>
            )}
            {currentParticipant && !isHost && (
              <Button variant="secondary" onClick={() => leave.mutate()} loading={leave.isPending}>
                Leave lobby
              </Button>
            )}
            {isHost && (
              <button
                type="button"
                onClick={deleteLobby}
                disabled={deletion.isPending}
                className="min-h-11 rounded-xl border border-danger-400 px-4 text-sm font-bold text-danger-400 transition hover:bg-danger-50 disabled:opacity-60"
              >
                {deletion.isPending ? 'Deleting…' : 'Delete lobby'}
              </button>
            )}
          </div>
        </div>
      </div>
      <FormError message={actionError instanceof Error ? actionError.message : undefined} />
      <div className="grid gap-5 xl:grid-cols-2">
        <TeamRoster team="HOME" participants={participants} />
        <TeamRoster team="AWAY" participants={participants} />
      </div>
      <ChatPanel />
    </section>
  );
}
