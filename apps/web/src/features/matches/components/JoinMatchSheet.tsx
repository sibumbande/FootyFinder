import { getMaxParticipantsPerTeam, type Match } from '@footy-finder/shared';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '@/features/notifications/NotificationProvider.js';
import { TicketConfirmSheet } from '@/features/tickets/components/TicketConfirmSheet.js';
import { formatClock } from '../utils/go-no-go-format.js';

/**
 * DEC-021 A1: joining from an invitation or the public preview buys a match ticket for a substitute place on a side
 * that has room; in the lobby the player can then take an open position on their side. The go/no-go rule (DEC-018)
 * is shown before paying.
 */
export function JoinMatchSheet({ match, open, onClose }: { match: Match; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { notify } = useNotifications();
  if (!open) return null;
  const limit = getMaxParticipantsPerTeam(match.format, match.substituteCapacityPerTeam);
  const sides = (['HOME', 'AWAY'] as const).filter((side) => (side === 'HOME' ? match.homeParticipantCount : match.awayParticipantCount) < limit);
  const free = match.freeOnFootyFinder || match.feeCents === 0;
  return (
    <TicketConfirmSheet
      match={match}
      place={{ seat: 'SUBSTITUTE' }}
      sides={sides}
      onClose={onClose}
      onConfirmed={() => {
        notify({ variant: 'success', title: 'You’re in', message: 'You joined as a sub. Tap an open position on your side to take it.' });
        navigate(`/matches/${match.id}`, { replace: true });
      }}
      notice={
        <>
          {match.goNoGoAt && (
            <p data-testid="join-go-no-go-notice" className="mt-4 rounded-xl border border-warning-300 bg-warning-50 p-3 text-sm font-semibold text-content">
              This match goes ahead only if every position is filled and a FootyFinder referee is assigned by {formatClock(match.goNoGoAt)} (30 minutes
              before kickoff). If not, it&apos;s cancelled automatically{free ? '. It is free, so there is nothing to refund.' : ' and you choose a match credit or a full refund.'}
            </p>
          )}
          {/* CEO touch-up batch 4, item 1. */}
          {match.girlsOnly && <p className="mt-3 text-sm font-semibold text-content" data-testid="join-girls-only-notice">This is a girls-only match: only female players can join.</p>}
          {/* CEO touch-up batch 3, item 5. */}
          {match.firstTimersOnly && <p className="mt-3 text-sm font-semibold text-content">This free match is for players who have never played a match on FootyFinder.</p>}
        </>
      }
    />
  );
}
