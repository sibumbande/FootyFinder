import { FormError } from '@/components/ui/FormError.js';
import { useDiscover } from '../hooks/useSocial.js';
import { SocialEmpty } from './SocialEmpty.js';
import { SocialPlayerCardView } from './SocialPlayerCardView.js';

/** Discover: search players by name or username; with no search, players you've played with. */
export function DiscoverTab({ query }: { query: string }) {
  const search = query.length >= 2 ? query : '';
  const players = useDiscover(search);
  return (
    <div className="grid gap-4">
      <p className="text-xs font-black uppercase tracking-[0.12em] text-content-muted">
        {search ? `Players matching "${search}"` : 'Players you played with'}
      </p>
      <FormError message={players.error?.message} />
      {players.isPending && <div className="h-24 animate-pulse rounded-2xl bg-surface-muted" />}
      {players.data?.length === 0 && <SocialEmpty message="No new profiles found." />}
      <div className="grid gap-3 md:grid-cols-2">
        {players.data?.map((player) => <SocialPlayerCardView key={player.id} player={player} />)}
      </div>
    </div>
  );
}
