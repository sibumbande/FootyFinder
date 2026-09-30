import type { LookingCardView } from '@footy-finder/shared';
import { Link } from 'react-router-dom';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { availabilityLabel, positionLabel } from '../recruitment-labels.js';
import { InviteToTeamMenu } from './InviteToTeamMenu.js';
import { SocialPlayerCardView } from './SocialPlayerCardView.js';

/** A "Players looking" card: Add friend, Invite to your team, Report. */
export function LookingCardItem({ card }: { card: LookingCardView }) {
  const { user } = useAuth();
  const mine = user?.id === card.player.id;
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
          <span className="flex flex-col items-end gap-1">
            <InviteToTeamMenu userId={card.player.id} source="LOOKING" />
            <Link className="text-[11px] font-black uppercase text-content-muted hover:text-content-strong" to={`/report/LOOKING_CARD/${card.id}`}>Report</Link>
          </span>
        ) : undefined
      }
    />
  );
}
