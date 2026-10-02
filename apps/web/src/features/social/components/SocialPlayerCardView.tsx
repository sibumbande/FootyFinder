import type { SocialPlayerCard } from '@footy-finder/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar.js';
import { FriendButton } from './FriendButton.js';
import { PlayerName } from '@/components/ui/PlayerName.js';

const positionLabel = (position: string) => position.charAt(0) + position.slice(1).toLowerCase();

/**
 * Gate 9: one player tile for Discover, Friends, requests, "Players looking" and "Players you played with".
 * CEO touch-up batch 3, item 9: a clean, symmetrical row on phones: photo, the full name (wraps, never cut off),
 * the primary position chip, and the actions on the right. The Friends tab hides the username and the
 * "Friends" badge, which are redundant there.
 */
export function SocialPlayerCardView({
  player,
  actions,
  note,
  showUsername = true,
  showFriendButton = true,
  actionsBelowOnPhone = false,
}: {
  player: SocialPlayerCard;
  actions?: ReactNode;
  note?: ReactNode;
  showUsername?: boolean;
  showFriendButton?: boolean;
  /** Wide action sets (Accept / Decline) sit under the name on phones so the name keeps its width. */
  actionsBelowOnPhone?: boolean;
}) {
  const primary = player.preferredPositions[0];
  return (
    <article className={`grid items-center gap-3 ${actionsBelowOnPhone ? 'grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[auto_minmax(0,1fr)_auto]' : 'grid-cols-[auto_minmax(0,1fr)_auto]'} rounded-2xl border border-line bg-surface p-3 shadow-sm sm:p-4`} data-testid="social-player-card">
      <Link to={`/players/${player.id}`} className="shrink-0">
        <Avatar user={player} size="md" />
      </Link>
      <div className="min-w-0">
        <Link to={`/players/${player.id}`} className="block min-w-0 font-black leading-snug text-content-strong hover:underline">
          <PlayerName name={player.displayName} />
        </Link>
        {showUsername && (
          <p className="break-words text-xs text-content-muted">
            @{player.username}
            {player.city ? ` · ${player.city}` : ''}
            {player.homeArea ? ` · ${player.homeArea}` : ''}
          </p>
        )}
        {primary && (
          <p className="mt-1">
            <span className="inline-block rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-black uppercase tracking-wide text-content-muted">
              {positionLabel(primary)}
            </span>
          </p>
        )}
        {note}
      </div>
      <div className={`flex shrink-0 items-center gap-2 ${actionsBelowOnPhone ? 'col-start-2 justify-start sm:col-start-auto sm:justify-end' : 'justify-end'}`}>
        {showFriendButton && <FriendButton userId={player.id} />}
        {actions}
      </div>
    </article>
  );
}
