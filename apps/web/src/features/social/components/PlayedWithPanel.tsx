import type { Match } from '@footy-finder/shared';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { useAddAll, usePlayedWith } from '../hooks/useSocial.js';
import { SocialPlayerCardView } from './SocialPlayerCardView.js';

/**
 * CEO Gate 9 "after a match": everyone in the Lineup Record (both sides) with an Add friend button
 * each and "Add all". Shown only to players in that record (and the referee).
 */
export function PlayedWithPanel({ match }: { match: Pick<Match, 'id' | 'status'> }) {
  const { user } = useAuth();
  const finished = ['AWAITING_RESULT', 'COMPLETED'].includes(match.status);
  const playedWith = usePlayedWith(match.id, finished && Boolean(user?.onboardingComplete));
  const addAll = useAddAll(match.id);
  if (!finished || !playedWith.data || playedWith.data.players.length === 0) return null;
  const players = playedWith.data.players;
  const canAdd = players.some(({ relationship }) => relationship.state === 'CAN_REQUEST' || relationship.state === 'INCOMING');
  return (
    <section className="anime-panel grid gap-4 p-5" data-testid="played-with">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="anime-kicker">After the match</p>
          <h2 className="mt-2 text-2xl font-black uppercase text-content-strong">Players you played with</h2>
          <p className="text-sm text-content-muted">Your teammates and opponents from the lineup. Add them so you can play together again.</p>
        </div>
        {canAdd && (
          <Button onClick={() => addAll.mutate()} loading={addAll.isPending} data-testid="add-all-friends">
            Add all
          </Button>
        )}
      </div>
      {addAll.data && (
        <p className="text-sm font-semibold text-content-strong" role="status">
          {addAll.data.sent === 1 ? '1 friend request sent.' : `${addAll.data.sent} friend requests sent.`}
          {addAll.data.limitReached && ' You have 100 requests waiting for an answer, so the rest were not sent.'}
        </p>
      )}
      <FormError message={addAll.error?.message} />
      <div className="grid gap-3 md:grid-cols-2">
        {players.map((player) => (
          <SocialPlayerCardView
            key={player.id}
            player={player}
            note={<p className="mt-1 text-[10px] font-black uppercase tracking-wide text-brand-700">{player.teammate ? 'Teammate' : 'Opponent'}</p>}
          />
        ))}
      </div>
    </section>
  );
}
