import type { MatchReferee, MatchStatus } from '@footy-finder/shared';

/**
 * Gate 8 / D18: every match with a T-30 go/no-go needs a FootyFinder referee. Players see the
 * referee's display name once one is assigned, or that the referee is still to be confirmed.
 * Renders nothing for legacy matches without a go/no-go and for cancelled matches.
 */
export function MatchRefereeLine({
  referee,
  goNoGoAt,
  status,
}: {
  referee?: MatchReferee | null;
  goNoGoAt?: string;
  status: MatchStatus;
}) {
  if (!goNoGoAt || status === 'CANCELLED') return null;
  return (
    <p data-testid="match-referee" className="text-sm text-content">
      <span className="font-bold text-content-strong">FootyFinder referee: </span>
      {referee ? referee.displayName : 'to be confirmed'}
    </p>
  );
}
