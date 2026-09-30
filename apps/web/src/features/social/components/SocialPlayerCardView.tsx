import type { SocialPlayerCard } from '@footy-finder/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar.js';
import { FriendButton } from './FriendButton.js';

const positionLabel = (position: string) => position.charAt(0) + position.slice(1).toLowerCase();

/** Gate 9: one player tile for Discover, Friends and "Players you played with". */
export function SocialPlayerCardView({ player, actions, note }: { player: SocialPlayerCard; actions?: ReactNode; note?: ReactNode }) {
  return (
    <article className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm" data-testid="social-player-card">
      <Link to={`/players/${player.id}`} className="shrink-0">
        <Avatar user={player} size="md" />
      </Link>
      <div className="min-w-0 flex-1">
        <Link to={`/players/${player.id}`} className="block truncate font-black text-content-strong hover:underline">
          {player.displayName}
        </Link>
        <p className="truncate text-xs text-content-muted">
          @{player.username}
          {player.city ? ` · ${player.city}` : ''}
          {player.homeArea ? ` · ${player.homeArea}` : ''}
        </p>
        {player.preferredPositions.length > 0 && (
          <p className="mt-1 flex flex-wrap gap-1">
            {player.preferredPositions.map((position) => (
              <span key={position} className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-content-muted">
                {positionLabel(position)}
              </span>
            ))}
          </p>
        )}
        {note}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <FriendButton userId={player.id} />
        {actions}
      </div>
    </article>
  );
}
