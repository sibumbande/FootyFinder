import type { LookingCardView } from '@footy-finder/shared';
import { Link } from 'react-router-dom';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { availabilityLabel, positionLabel } from '../recruitment-labels.js';
import { ActionMenu, menuItemClass } from '@/components/ui/ActionMenu.js';
import { InviteToTeamItems, useInvitableTeams } from './InviteToTeamItems.js';
import { SocialPlayerCardView } from './SocialPlayerCardView.js';

/** A "Players looking" card: Add friend, Invite to your team, Report. */
export function LookingCardItem({ card }: { card: LookingCardView }) {
  const { user } = useAuth();
  const mine = user?.id === card.player.id;
  const canInvite = useInvitableTeams().length > 0;
  return (
    <SocialPlayerCardView
      player={card.player}
      note={
        <div className="mt-1 grid gap-1 text-xs text-content-muted" data-testid="looking-card">
          <p>Looking for a team · {card.positions.map(positionLabel).join(', ')}</p>
          <p>{card.area ? `${card.area} · ` : ''}{availabilityLabel(card.days, card.times)}</p>
          {card.note && <p className="text-content">{card.note}</p>}
        </div>
      }
      actions={
        mine ? (
          <span className="text-[11px] font-black uppercase text-content-muted">You</span>
        ) : user ? (
          // CEO touch-up batch 3, item 9: Invite to team and Report live in the card's "⋯" menu.
          <ActionMenu label={`More actions for ${card.player.displayName}`}>
            {(close) => (
              <>
                {canInvite && <InviteToTeamItems userId={card.player.id} playerName={card.player.displayName} source="LOOKING" close={close} />}
                <Link role="menuitem" className={menuItemClass} to={`/report/LOOKING_CARD/${card.id}`} onClick={close}>Report</Link>
              </>
            )}
          </ActionMenu>
        ) : undefined
      }
    />
  );
}
